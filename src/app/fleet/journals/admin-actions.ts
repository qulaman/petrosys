"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { aqtobeDate } from "@/lib/tz";
import { zUuid } from "@/lib/validation";
import { devError, IS_DEV } from "@/lib/dev-log";
import { dbError } from "@/lib/db-error";

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
    return { ok: false, error: dbError("fleet/journals/admin-actions", error) };
  }
  refreshJournals();
  return { ok: true };
}

/**
 * Удаление выдачи ГСМ вместе с файлами подписи и чека.
 *
 * ВНИМАНИЕ — осознанное решение заказчика, а не недосмотр: файлы стираются из
 * Storage, поэтому восстановить выдачу из `audit_log.old_row` целиком уже
 * нельзя — путь в старой строке сохранится, но объекта по нему не будет.
 * Взамен в бакетах не копятся сироты. Не «чинить» это, не обсудив.
 *
 * Порядок — сначала строка, потом файлы: если удаление объекта упадёт,
 * останется файл-сирота, а не запись без юридически значимой подписи.
 */
async function deleteFuelIssueWithFiles(id: string): Promise<Result> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("fuel_issues")
    .select("driver_signature_url, receipt_photo_url")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("fuel_issues").delete().eq("id", id);
  if (error) {
    devError("deleteFuelIssueWithFiles", error);
    return { ok: false, error: dbError("fleet/journals/admin-actions", error) };
  }

  // Через admin: политик DELETE на бакетах нет, а право уже проверено выше.
  const admin = createAdminClient();
  const drop = async (bucket: string, path: string | null | undefined) => {
    if (!path) return;
    const { error: e } = await admin.storage.from(bucket).remove([path]);
    if (e) devError("deleteFuelIssueWithFiles", `${bucket}/${path}`, e);
  };
  await Promise.all([
    drop("signatures", row?.driver_signature_url),
    drop("receipts", row?.receipt_photo_url),
  ]);
  return { ok: true };
}

export async function adminDeleteFuelIssue(id: string): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const res = await deleteFuelIssueWithFiles(id);
  if (!res.ok) return res;
  refreshJournals();
  revalidatePath("/fleet/fuel/tanker");
  return { ok: true };
}

/** Типы документов, выпуск которых означает «период закрыт». */
const CLOSING_DOC_TYPES = ["avr", "fuel_statement", "reconciliation_act"];
const CLOSING_DOC_LABELS: Record<string, string> = {
  avr: "АВР",
  fuel_statement: "ведомость ГСМ",
  reconciliation_act: "акт сверки",
};

/**
 * Что именно потеряется при удалении выдачи — для диалога подтверждения.
 * Проверка «период уже закрыт актом» предупреждает, но не блокирует:
 * администратор решает сам (решение заказчика от 28.07.2026).
 */
export interface FuelIssueDeleteInfo {
  hasSignature: boolean;
  hasReceipt: boolean;
  /** Номера документов, чей период накрывает дату выдачи. */
  closingDocs: string[];
}

export async function fuelIssueDeleteInfo(
  id: string,
): Promise<{ ok: true; info: FuelIssueDeleteInfo } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { data: issue } = await supabase
    .from("fuel_issues")
    .select("created_at, vehicle_id, driver_signature_url, receipt_photo_url")
    .eq("id", id)
    .single();
  if (!issue) return { ok: false, error: "Запись не найдена" };

  const day = aqtobeDate(issue.created_at);
  const { data: veh } = await supabase
    .from("vehicles")
    .select("contract_id")
    .eq("id", issue.vehicle_id)
    .single();

  let closingDocs: string[] = [];
  if (veh?.contract_id) {
    const { data: docs } = await supabase
      .from("generated_documents")
      .select("number, doc_type, period_from, period_to")
      .eq("contract_id", veh.contract_id)
      .in("doc_type", CLOSING_DOC_TYPES)
      .lte("period_from", day)
      .gte("period_to", day);
    closingDocs = (docs ?? []).map((d) => `${CLOSING_DOC_LABELS[d.doc_type] ?? d.doc_type} № ${d.number}`);
  }

  return {
    ok: true,
    info: {
      hasSignature: !!issue.driver_signature_url,
      hasReceipt: !!issue.receipt_photo_url,
      closingDocs,
    },
  };
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
  if (error) return { ok: false, error: dbError("fleet/journals/admin-actions", error) };
  refreshJournals();
  return { ok: true };
}

export async function adminDeleteTrip(id: string): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("trip_records").delete().eq("id", id);
  if (error) return { ok: false, error: dbError("fleet/journals/admin-actions", error) };
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
    return { ok: false, error: dbError("fleet/journals/admin-actions", error) };
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
  if (error) return { ok: false, error: dbError("fleet/journals/admin-actions", error) };
  refreshJournals();
  revalidatePath("/fleet/shifts");
  return { ok: true };
}

// ------------------------------- Бензовоз -------------------------------
/**
 * Удаление операции из истории бензовоза. Приход и замер живут только на этом
 * экране, выдача — ещё и в журнале ГСМ, поэтому ревалидируем и то, и другое.
 * Баланс пересчитывать не нужно: `tanker_balances` — view над этими таблицами.
 */
export async function adminDeleteTankerEvent(
  kind: "refill" | "measurement" | "issue",
  id: string,
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  if (kind === "issue") {
    const res = await deleteFuelIssueWithFiles(id);
    if (!res.ok) return res;
    refreshJournals();
    revalidatePath("/fleet/fuel/tanker");
    return { ok: true };
  }

  const supabase = await createClient();
  const table = kind === "refill" ? "tanker_refills" : "tanker_measurements";
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return { ok: false, error: dbError("fleet/journals/admin-actions", error) };
  revalidatePath("/fleet/fuel/tanker");
  return { ok: true };
}
