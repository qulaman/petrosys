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
  const { data: onLine } = await supabase
    .from("trip_lineup_vehicles")
    .select("id")
    .eq("lineup_id", d.lineup_id)
    .eq("vehicle_id", d.vehicle_id)
    .maybeSingle();
  if (!onLine)
    return { ok: false, error: "Машина не выведена на линию — сначала выведите её на линию" };

  const { data, error } = await supabase
    .from("trip_records")
    .insert({
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
 * Отмена записи: учётчик — свою в 5-минутном окне, офис/админ — любую
 * (обе политики в RLS). RLS фильтрует молча, поэтому различаем «удалено»
 * и «право не дало» по числу удалённых строк.
 */
export async function deleteTrip(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("trip_records").delete().eq("id", id).select("id");
  if (error) {
    devError("deleteTrip", error);
    return { ok: false, error: error.message };
  }
  if (!data?.length)
    return { ok: false, error: "Отменить можно в течение 5 минут после записи — либо обратитесь в офис" };
  revalidatePath("/fleet/trips");
  return { ok: true };
}
