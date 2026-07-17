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
    .update({ liters: p.data.liters, odometer: p.data.odometer, driver_id: p.data.driver_id })
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
    .update({ driver_id: p.data.driver_id, route_id: p.data.route_id })
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
