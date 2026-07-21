"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { zUuid } from "@/lib/validation";
import { devError, IS_DEV } from "@/lib/dev-log";

type Result = { ok: true; id?: string } | { ok: false; error: string };
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

// -----------------------------------------------------------------------------
// Этап 1 — вывод самосвалов на линию (перечень смены)
// -----------------------------------------------------------------------------
const createLineupSchema = z.object({
  work_date: z.string().regex(dateRe),
  shift_type: z.enum(["day", "night"]),
  inherit_from: zUuid.nullable(), // id перечня прошлой смены или null (чистый лист)
});

export async function createLineup(
  input: z.infer<typeof createLineupSchema>,
): Promise<Result> {
  const p = createLineupSchema.safeParse(input);
  if (!p.success) return { ok: false, error: IS_DEV ? p.error.message : "Проверьте данные" };
  const d = p.data;

  const supabase = await createClient();
  const { data: lineup, error } = await supabase
    .from("trip_lineups")
    .insert({ work_date: d.work_date, shift_type: d.shift_type })
    .select("id")
    .single();
  if (error) {
    // Параллельное создание вторым учётчиком — перечень уже есть, просто обновляемся.
    if (error.message.includes("duplicate")) {
      revalidatePath("/fleet/trips");
      return { ok: true };
    }
    devError("createLineup", error);
    return { ok: false, error: error.message };
  }

  if (d.inherit_from) {
    const { data: prevVehicles } = await supabase
      .from("trip_lineup_vehicles")
      .select("vehicle_id")
      .eq("lineup_id", d.inherit_from);
    const rows = (prevVehicles ?? []).map((v) => ({
      lineup_id: lineup.id,
      vehicle_id: v.vehicle_id,
    }));
    if (rows.length) {
      const { error: vehErr } = await supabase.from("trip_lineup_vehicles").insert(rows);
      if (vehErr) devError("createLineup/inherit", vehErr);
    }
  }

  revalidatePath("/fleet/trips");
  return { ok: true, id: lineup.id };
}

const lineupVehicleSchema = z.object({
  lineup_id: zUuid,
  vehicle_id: zUuid,
});

export async function addLineupVehicle(
  input: z.infer<typeof lineupVehicleSchema>,
): Promise<Result> {
  const p = lineupVehicleSchema.safeParse(input);
  if (!p.success) return { ok: false, error: IS_DEV ? p.error.message : "Проверьте данные" };

  const supabase = await createClient();
  const { error } = await supabase.from("trip_lineup_vehicles").insert(p.data);
  if (error && !error.message.includes("duplicate")) {
    devError("addLineupVehicle", error);
    return { ok: false, error: error.message };
  }
  revalidatePath("/fleet/trips");
  return { ok: true };
}

/** Границы смены в поясе Asia/Aqtobe (UTC+5): день 07–19, ночь 19–07. */
function shiftWindow(workDate: string, shift: "day" | "night") {
  const nextDay = new Date(`${workDate}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const next = nextDay.toISOString().slice(0, 10);
  const from = shift === "day" ? `${workDate}T07:00:00+05:00` : `${workDate}T19:00:00+05:00`;
  const to = shift === "day" ? `${workDate}T19:00:00+05:00` : `${next}T07:00:00+05:00`;
  return { fromISO: new Date(from).toISOString(), toISO: new Date(to).toISOString() };
}

export async function removeLineupVehicle(
  input: z.infer<typeof lineupVehicleSchema>,
): Promise<Result> {
  const p = lineupVehicleSchema.safeParse(input);
  if (!p.success) return { ok: false, error: IS_DEV ? p.error.message : "Проверьте данные" };
  const d = p.data;

  const supabase = await createClient();
  const { data: lineup } = await supabase
    .from("trip_lineups")
    .select("work_date, shift_type")
    .eq("id", d.lineup_id)
    .single();
  if (!lineup) return { ok: false, error: "Перечень не найден" };

  // Машину с рейсами за эту смену с линии не снимаем — целостность учёта.
  const w = shiftWindow(lineup.work_date, lineup.shift_type as "day" | "night");
  const { count } = await supabase
    .from("trip_records")
    .select("id", { count: "exact", head: true })
    .eq("vehicle_id", d.vehicle_id)
    .gte("created_at", w.fromISO)
    .lt("created_at", w.toISO);
  if ((count ?? 0) > 0)
    return { ok: false, error: "По машине уже есть рейсы за смену — снять с линии нельзя" };

  const { error } = await supabase
    .from("trip_lineup_vehicles")
    .delete()
    .eq("lineup_id", d.lineup_id)
    .eq("vehicle_id", d.vehicle_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/fleet/trips");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Этап 2 — фиксация рейса (только по машинам, выведенным на линию)
// -----------------------------------------------------------------------------
const schema = z.object({
  lineup_id: zUuid,
  route_id: zUuid,
  vehicle_id: zUuid,
  driver_id: zUuid,
  driver_signature_url: z.string().nullable(),
  geo_lat: z.number().nullable(),
  geo_lng: z.number().nullable(),
});

export async function createTrip(input: z.infer<typeof schema>): Promise<Result> {
  const p = schema.safeParse(input);
  if (!p.success) {
    const issues = p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    devError("createTrip", "валидация:", issues, input);
    return { ok: false, error: IS_DEV ? `Проверьте поля — ${issues}` : "Проверьте данные рейса" };
  }
  const d = p.data;

  const supabase = await createClient();
  const [{ data: onLine }, { data: lineup }] = await Promise.all([
    supabase
      .from("trip_lineup_vehicles")
      .select("id")
      .eq("lineup_id", d.lineup_id)
      .eq("vehicle_id", d.vehicle_id)
      .maybeSingle(),
    supabase.from("trip_lineups").select("status").eq("id", d.lineup_id).single(),
  ]);
  if (!onLine)
    return { ok: false, error: "Машина не выведена на линию — сначала выведите её на линию" };
  if (lineup?.status === "closed")
    return { ok: false, error: "Смена уже закрыта мастером — рейс не добавлен" };

  const { data, error } = await supabase
    .from("trip_records")
    .insert({
      lineup_id: d.lineup_id,
      route_id: d.route_id,
      vehicle_id: d.vehicle_id,
      driver_id: d.driver_id,
      driver_signature_url: d.driver_signature_url,
      geo_lat: d.geo_lat,
      geo_lng: d.geo_lng,
    })
    .select("id")
    .single();

  if (error) {
    devError("createTrip", "ошибка вставки:", error);
    return { ok: false, error: IS_DEV ? `БД: ${error.message}` : error.message };
  }
  revalidatePath("/fleet/trips");
  return { ok: true, id: data.id };
}

/**
 * Отмена записи: учётчик — свою в ОТКРЫТОЙ карточке смены, офис/админ — любую
 * (политики в RLS). RLS фильтрует молча, поэтому различаем «удалено» и
 * «право не дало» по числу удалённых строк.
 */
export async function deleteTrip(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("trip_records").delete().eq("id", id).select("id");
  if (error) {
    devError("deleteTrip", error);
    return { ok: false, error: error.message };
  }
  if (!data?.length)
    return { ok: false, error: "Карточка смены уже закрыта — изменения только через офис" };
  revalidatePath("/fleet/trips");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Закрытие карточки смены: мастер проверил рейсы, подписал, подтвердил.
// -----------------------------------------------------------------------------
const closeSchema = z.object({
  lineup_id: zUuid,
  signature_path: z.string().min(1, "Нет подписи мастера"),
});

export async function closeTripJournal(
  input: z.infer<typeof closeSchema>,
): Promise<Result> {
  const p = closeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: IS_DEV ? p.error.message : "Нет подписи мастера" };
  const d = p.data;

  const supabase = await createClient();
  const { count } = await supabase
    .from("trip_records")
    .select("id", { count: "exact", head: true })
    .eq("lineup_id", d.lineup_id);
  if (!count)
    return { ok: false, error: "В карточке нет ни одного рейса — закрывать нечего" };

  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("trip_lineups")
    .update({
      status: "closed",
      master_signature_url: d.signature_path,
      closed_by: user?.id ?? null,
      closed_at: new Date().toISOString(),
    })
    .eq("id", d.lineup_id)
    .eq("status", "open")
    .select("id");
  if (error) {
    devError("closeTripJournal", error);
    return { ok: false, error: error.message };
  }
  if (!data?.length) return { ok: false, error: "Карточка уже закрыта" };
  revalidatePath("/fleet/trips");
  return { ok: true };
}

/** Переоткрытие закрытой карточки — офис/админ (RLS не пустит учётчика). */
export async function reopenTripJournal(lineupId: string): Promise<Result> {
  const p = zUuid.safeParse(lineupId);
  if (!p.success) return { ok: false, error: "Неверный id" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trip_lineups")
    .update({ status: "open", master_signature_url: null, closed_by: null, closed_at: null })
    .eq("id", p.data)
    .eq("status", "closed")
    .select("id");
  if (error) {
    devError("reopenTripJournal", error);
    return { ok: false, error: error.message };
  }
  if (!data?.length)
    return { ok: false, error: "Переоткрыть может только офис или администратор" };
  revalidatePath("/fleet/trips");
  return { ok: true };
}
