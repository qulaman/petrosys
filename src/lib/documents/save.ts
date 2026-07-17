import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/current-user";

const MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const PREFIX: Record<string, string> = {
  contract: "ДОГ",
  appendix1: "П1",
  appendix2: "П2",
  amendment: "ДС",
  avr: "АВР",
  reconciliation_act: "АКТ-СВ",
  trip_register: "РР",
  fuel_statement: "ВГСМ",
  claim_overconsumption: "ПРЕТ",
  downtime_act: "АП",
};

export type DocType = keyof typeof PREFIX;

/** Гейт: формирование документов — office/admin. */
export async function requireOfficeAdmin(): Promise<
  { ok: true; orgId: string } | { ok: false; error: string }
> {
  const cur = await getCurrentProfile();
  if (!cur?.profile || !cur.profile.roles.some((r) => r === "office" || r === "admin"))
    return { ok: false, error: "Нет доступа" };
  return { ok: true, orgId: cur.profile.org_id };
}

/**
 * Сохраняет документ: файл → бакет documents, запись → реестр с автонумерацией
 * по типу (`ПРЕФИКС-0001/2026`). Возвращает присвоенный номер.
 */
export async function saveGeneratedDocument(args: {
  orgId: string;
  contractId: string;
  docType: DocType;
  buffer: Buffer;
  ext: "xlsx" | "docx";
  periodFrom?: string | null;
  periodTo?: string | null;
  numberOverride?: string; // например «П2 ред.3»
  sourceRefs?: Record<string, string | number | null>;
}): Promise<{ ok: true; number: string } | { ok: false; error: string }> {
  const supabase = await createClient();

  let number = args.numberOverride;
  if (!number) {
    const { count } = await supabase
      .from("generated_documents")
      .select("id", { count: "exact", head: true })
      .eq("doc_type", args.docType);
    const year = new Date().getFullYear();
    number = `${PREFIX[args.docType]}-${String((count ?? 0) + 1).padStart(4, "0")}/${year}`;
  }

  const path = `${args.orgId}/${crypto.randomUUID()}.${args.ext}`;
  const admin = createAdminClient();
  const up = await admin.storage
    .from("documents")
    .upload(path, args.buffer, { contentType: MIME[args.ext], upsert: false });
  if (up.error) return { ok: false, error: up.error.message };

  const { error } = await supabase.from("generated_documents").insert({
    contract_id: args.contractId,
    doc_type: args.docType,
    number,
    period_from: args.periodFrom ?? null,
    period_to: args.periodTo ?? null,
    source_refs: args.sourceRefs ?? null,
    file_url: path,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, number };
}
