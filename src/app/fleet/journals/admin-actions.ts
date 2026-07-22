"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { zUuid } from "@/lib/validation";
import { devError, IS_DEV } from "@/lib/dev-log";

type Result = { ok: true } | { ok: false; error: string };

/** Правка/удаление операционных записей — только администратор. */
async function requireAdmin(): Promise<Result> {
  const cur = await getCurrentProfile();
  if (!cur?.profile?.roles.includes("admin"))
    return { ok: false, error: "Только администратор может править записи" };
  return { ok: true };
}

function zodFail(e: z.ZodError): Result {
  const msg = e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { ok: false, error: IS_DEV ? msg : "Проверьте поля" };
}

function refreshJournals() {
  revalidatePath("/fleet/journals/fuel");
  revalidatePath("/fleet/journals/trips");
  revalidatePath("/fleet/journals/shifts");
}

// ------------------------------- ГСМ -------------------------------
const fuelEditSchema = z.object({
  id: zUuid,
  liters: z.number().positive().max(100000),
  odometer: z.number().nonnegative().nullable(),
  driver_id: zUuid,
  vehicle_id: zUuid,
});

export async function adminUpdateFuelIssue(
  input: z.infer<typeof fuelEditSchema>,
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const p = fuelEditSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("fuel_issues")
    .update({ liters: p.data.liters, odometer: p.data.odometer, driver_id: p.data.driver_id, vehicle_id: p.data.vehicle_id })
    .eq("id", p.data.id);
  if (error) {
    devError("adminUpdateFuelIssue", error);
    return { ok: false, error: error.message };
  }
  refreshJournals();
  return { ok: true };
}

export async function adminDeleteFuelIssue(id: string): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("fuel_issues").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refreshJournals();
  return { ok: true };
}

// ------------------------------- Рейсы -------------------------------
const tripEditSchema = z.object({
  id: zUuid,
  driver_id: zUuid,
  route_id: zUuid,
  vehicle_id: zUuid,
});

export async function adminUpdateTrip(
  input: z.infer<typeof tripEditSchema>,
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const p = tripEditSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("trip_records")
    .update({ driver_id: p.data.driver_id, route_id: p.data.route_id, vehicle_id: p.data.vehicle_id })
    .eq("id", p.data.id);
  if (error) return { ok: false, error: error.message };
  refreshJournals();
  return { ok: true };
}

export async function adminDeleteTrip(id: string): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("trip_records").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refreshJournals();
  return { ok: true };
}

// ------------------------------- Смены -------------------------------
const shiftEditSchema = z.object({
  id: zUuid,
  hours: z.number().positive().max(24),
  driver_id: zUuid,
  work_type_id: zUuid.nullable(),
  vehicle_id: zUuid,
});

/**
 * Правка смены администратором с соблюдением инвариантов табеля:
 * закрытый журнал неизменяем (сначала переоткрыть в Табеле), а изменение
 * часов/водителя сбрасывает подпись работника — она стояла под другими данными.
 */
export async function adminUpdateShiftRecord(
  input: z.infer<typeof shiftEditSchema>,
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const p = shiftEditSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);

  const supabase = await createClient();
  const { data: old } = await supabase
    .from("shift_records")
    .select("hours, driver_id, journal_id")
    .eq("id", p.data.id)
    .single();
  if (!old) return { ok: false, error: "Запись не найдена" };

  if (old.journal_id) {
    const { data: j } = await supabase.from("shift_journals").select("status").eq("id", old.journal_id).single();
    if (j?.status === "closed")
      return { ok: false, error: "Журнал смены закрыт — переоткройте его на экране «Табель» (кнопка администратора), затем правьте" };
  }

  const signatureReset = Number(old.hours) !== p.data.hours || old.driver_id !== p.data.driver_id;
  const { error } = await supabase
    .from("shift_records")
    .update({
      hours: p.data.hours,
      driver_id: p.data.driver_id,
      work_type_id: p.data.work_type_id,
      vehicle_id: p.data.vehicle_id,
      ...(signatureReset ? { driver_signature_url: null } : {}),
    })
    .eq("id", p.data.id);
  if (error) {
    devError("adminUpdateShiftRecord", error);
    return { ok: false, error: error.message };
  }
  refreshJournals();
  revalidatePath("/fleet/shifts");
  return { ok: true };
}

export async function adminDeleteShiftRecord(id: string): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("shift_records").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refreshJournals();
  revalidatePath("/fleet/shifts");
  return { ok: true };
}

// ------------------------------- Бензовоз -------------------------------
export async function adminDeleteTankerEvent(
  kind: "refill" | "measurement",
  id: string,
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const table = kind === "refill" ? "tanker_refills" : "tanker_measurements";
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/fleet/fuel/tanker");
  return { ok: true };
}
