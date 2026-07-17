"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { zUuid } from "@/lib/validation";
import { devError, IS_DEV } from "@/lib/dev-log";

type Result = { ok: true; id?: string } | { ok: false; error: string };
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function zodFail(e: z.ZodError): Result {
  const msg = e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { ok: false, error: IS_DEV ? msg : "Проверьте поля" };
}

// -----------------------------------------------------------------------------
// Этап 1 — создание журнала: с чистого листа или наследованием предыдущей смены
// -----------------------------------------------------------------------------
const createSchema = z.object({
  shift_date: z.string().regex(dateRe),
  shift_type: z.enum(["day", "night"]),
  work_type_id: zUuid.nullable(),
  inherit_from: zUuid.nullable(), // id предыдущего журнала или null (чистый лист)
});

export async function createJournal(
  input: z.infer<typeof createSchema>,
): Promise<Result> {
  const p = createSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);
  const d = p.data;

  const supabase = await createClient();
  const { data: journal, error } = await supabase
    .from("shift_journals")
    .insert({
      shift_date: d.shift_date,
      shift_type: d.shift_type,
      work_type_id: d.work_type_id,
    })
    .select("id")
    .single();
  if (error) {
    devError("createJournal", error);
    const msg = error.message.includes("duplicate")
      ? "Журнал на эту смену уже существует"
      : error.message;
    return { ok: false, error: msg };
  }

  // Подхватываем записи этой смены БЕЗ журнала (созданные старым табелем или
  // осиротевшие) — иначе они блокируют добавление машин уникальностью
  // (vehicle, date, shift), оставаясь невидимыми в перечне.
  await supabase
    .from("shift_records")
    .update({ journal_id: journal.id })
    .eq("shift_date", d.shift_date)
    .eq("shift_type", d.shift_type)
    .is("journal_id", null);

  // Наследование перечня: копируем машины/водителей, часы = 10, без подписей.
  // Машины, уже попавшие в журнал (подхваченные сироты), пропускаем.
  if (d.inherit_from) {
    const [{ data: prevLines }, { data: existingNow }] = await Promise.all([
      supabase.from("shift_records").select("vehicle_id, driver_id").eq("journal_id", d.inherit_from),
      supabase.from("shift_records").select("vehicle_id").eq("journal_id", journal.id),
    ]);
    const have = new Set((existingNow ?? []).map((r) => r.vehicle_id));
    const rows = (prevLines ?? [])
      .filter((l) => !have.has(l.vehicle_id))
      .map((l) => ({
        journal_id: journal.id,
        vehicle_id: l.vehicle_id,
        driver_id: l.driver_id,
        hours: 10,
        shift_date: d.shift_date,
        shift_type: d.shift_type,
        work_type_id: d.work_type_id,
      }));
    if (rows.length) {
      const { error: linesErr } = await supabase.from("shift_records").insert(rows);
      if (linesErr) devError("createJournal/inherit", linesErr);
    }
  }

  revalidatePath("/fleet/shifts");
  return { ok: true, id: journal.id };
}

// -----------------------------------------------------------------------------
// Правки журнала (вид работ, переход draft → filling)
// -----------------------------------------------------------------------------
export async function updateJournal(
  journalId: string,
  patch: { work_type_id?: string | null; status?: "filling" },
): Promise<Result> {
  const supabase = await createClient();

  const upd: { work_type_id?: string | null; status?: string } = {};
  if ("work_type_id" in patch) upd.work_type_id = patch.work_type_id ?? null;
  if (patch.status === "filling") upd.status = "filling";
  if (!Object.keys(upd).length) return { ok: true };

  const { error } = await supabase
    .from("shift_journals")
    .update(upd)
    .eq("id", journalId)
    .neq("status", "closed"); // закрытый журнал не правится
  if (error) return { ok: false, error: error.message };

  // Вид работ дублируем в строки (документ-строки самодостаточны).
  if ("work_type_id" in patch) {
    await supabase
      .from("shift_records")
      .update({ work_type_id: patch.work_type_id ?? null })
      .eq("journal_id", journalId);
  }
  revalidatePath("/fleet/shifts");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Строки перечня (добавить / изменить / убрать)
// -----------------------------------------------------------------------------
const addLineSchema = z.object({
  journal_id: zUuid,
  vehicle_id: zUuid,
  driver_id: zUuid,
});

export async function addLine(input: z.infer<typeof addLineSchema>): Promise<Result> {
  const p = addLineSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);

  const supabase = await createClient();
  const { data: j } = await supabase
    .from("shift_journals")
    .select("shift_date, shift_type, work_type_id, status")
    .eq("id", p.data.journal_id)
    .single();
  if (!j) return { ok: false, error: "Журнал не найден" };
  if (j.status === "closed") return { ok: false, error: "Журнал закрыт" };

  const { error } = await supabase.from("shift_records").insert({
    journal_id: p.data.journal_id,
    vehicle_id: p.data.vehicle_id,
    driver_id: p.data.driver_id,
    hours: 10,
    shift_date: j.shift_date,
    shift_type: j.shift_type,
    work_type_id: j.work_type_id,
  });
  if (error) {
    if (!error.message.includes("duplicate")) return { ok: false, error: error.message };

    // Конфликт уникальности (машина, дата, смена). Если существующая запись —
    // «сирота» без журнала (старый табель), усыновляем её вместо ошибки.
    const { data: existing } = await supabase
      .from("shift_records")
      .select("id, journal_id")
      .eq("vehicle_id", p.data.vehicle_id)
      .eq("shift_date", j.shift_date)
      .eq("shift_type", j.shift_type)
      .maybeSingle();

    if (existing && !existing.journal_id) {
      const { error: adoptErr } = await supabase
        .from("shift_records")
        .update({ journal_id: p.data.journal_id })
        .eq("id", existing.id);
      if (adoptErr) return { ok: false, error: adoptErr.message };
      revalidatePath("/fleet/shifts");
      return { ok: true };
    }
    return { ok: false, error: "Эта машина уже в журнале смены" };
  }
  revalidatePath("/fleet/shifts");
  return { ok: true };
}

const updateLineSchema = z.object({
  line_id: zUuid,
  hours: z.number().positive().max(24).optional(),
  driver_id: zUuid.optional(),
  signature_path: z.string().min(1).optional(), // подпись работника
});

export async function updateLine(
  input: z.infer<typeof updateLineSchema>,
): Promise<Result> {
  const p = updateLineSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);
  const d = p.data;

  const supabase = await createClient();
  const upd: { hours?: number; driver_id?: string; driver_signature_url?: string | null } = {};
  if (d.hours != null) upd.hours = d.hours;
  if (d.driver_id) upd.driver_id = d.driver_id;
  if (d.signature_path) upd.driver_signature_url = d.signature_path;
  // Корректировка часов или смена водителя аннулирует подпись — переподписать.
  if ((d.hours != null || d.driver_id) && !d.signature_path) {
    upd.driver_signature_url = null;
  }

  const { error } = await supabase.from("shift_records").update(upd).eq("id", d.line_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/fleet/shifts");
  return { ok: true };
}

export async function removeLine(lineId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("shift_records").delete().eq("id", lineId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/fleet/shifts");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Этап 3 — закрытие журнала подписью мастера
// -----------------------------------------------------------------------------
export async function closeJournal(
  journalId: string,
  itrSignaturePath: string,
): Promise<Result> {
  if (!itrSignaturePath) return { ok: false, error: "Нет подписи мастера" };
  const supabase = await createClient();

  // Все строки должны быть подписаны работниками.
  const { data: lines } = await supabase
    .from("shift_records")
    .select("id, driver_signature_url")
    .eq("journal_id", journalId);
  if (!lines?.length) return { ok: false, error: "В журнале нет ни одной машины" };
  const unsigned = lines.filter((l) => !l.driver_signature_url).length;
  if (unsigned > 0)
    return { ok: false, error: `Не подписано работниками: ${unsigned}. Подпишите или уберите строки.` };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("shift_journals")
    .update({
      status: "closed",
      itr_signature_url: itrSignaturePath,
      closed_by: user?.id ?? null,
      closed_at: new Date().toISOString(),
    })
    .eq("id", journalId)
    .neq("status", "closed");
  if (error) {
    devError("closeJournal", error);
    return { ok: false, error: error.message };
  }

  // Дублируем подпись мастера в строки — каждая запись самодостаточна как документ.
  await supabase
    .from("shift_records")
    .update({ itr_signature_url: itrSignaturePath })
    .eq("journal_id", journalId);

  revalidatePath("/fleet/shifts");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Переоткрытие закрытого журнала (только admin) — для исправления ошибок.
// Подпись мастера снимается с журнала и строк: после правок закрыть заново.
// -----------------------------------------------------------------------------
export async function reopenJournal(journalId: string): Promise<Result> {
  const { getCurrentProfile } = await import("@/lib/auth/current-user");
  const cur = await getCurrentProfile();
  if (!cur?.profile?.roles.includes("admin"))
    return { ok: false, error: "Переоткрыть журнал может только администратор" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("shift_journals")
    .update({ status: "filling", itr_signature_url: null, closed_by: null, closed_at: null })
    .eq("id", journalId)
    .eq("status", "closed");
  if (error) {
    devError("reopenJournal", error);
    return { ok: false, error: error.message };
  }
  await supabase
    .from("shift_records")
    .update({ itr_signature_url: null })
    .eq("journal_id", journalId);

  revalidatePath("/fleet/shifts");
  return { ok: true };
}
