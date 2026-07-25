"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ENTITIES } from "@/lib/admin/registry";
import { loadDirectorySheets } from "@/lib/data/directories";
import { buildDirectoriesWorkbook } from "@/lib/documents/directories-xlsx";
import { requireOfficeAdmin } from "@/lib/documents/save";
import { aqtobeToday } from "@/lib/tz";
import { devError } from "@/lib/dev-log";
import { dbError } from "@/lib/db-error";

type Result = { ok: true } | { ok: false; error: string; fkBlocked?: boolean };

function clean(slug: string, raw: Record<string, unknown>) {
  const cfg = ENTITIES[slug];
  const out: Record<string, unknown> = {};
  for (const f of cfg.fields) {
    const v = raw[f.key];
    if (f.type === "number") {
      out[f.key] = v === "" || v == null ? null : Number(v);
    } else if (f.type === "boolean") {
      out[f.key] = Boolean(v);
    } else {
      out[f.key] = v === "" || v == null ? null : String(v);
    }
  }
  return { cfg, out };
}

export async function upsertRow(
  slug: string,
  id: string | null,
  raw: Record<string, unknown>,
): Promise<Result> {
  if (!ENTITIES[slug]) return { ok: false, error: "Неизвестный справочник" };
  const { cfg, out } = clean(slug, raw);

  for (const f of cfg.fields) {
    if (f.required && (out[f.key] === null || out[f.key] === "")) {
      return { ok: false, error: `Заполните поле: ${f.label}` };
    }
  }

  // Конфиг-движок работает с динамическими именами таблиц — нетипизированный клиент.
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { error } = id
    ? await supabase.from(cfg.slug).update(out).eq("id", id)
    : await supabase.from(cfg.slug).insert(out);

  if (error) return { ok: false, error: dbError("fleet/admin/actions", error) };
  revalidatePath(`/fleet/admin/${slug}`);
  return { ok: true };
}

/**
 * Выгрузка ВСЕХ справочников одной книгой Excel (лист на справочник).
 * Данные читаются под RLS от имени пользователя — доступ office/admin.
 */
export async function exportDirectoriesXlsx(): Promise<
  { ok: true; base64: string; filename: string } | { ok: false; error: string }
> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  try {
    const today = aqtobeToday();
    const sheets = await loadDirectorySheets();
    const buf = await buildDirectoriesWorkbook(sheets, today.split("-").reverse().join("."));
    return {
      ok: true,
      base64: buf.toString("base64"),
      filename: `справочники-${today}.xlsx`,
    };
  } catch (e) {
    devError("exportDirectoriesXlsx", e);
    return { ok: false, error: "Не удалось сформировать выгрузку" };
  }
}

export async function deleteRow(slug: string, id: string): Promise<Result> {
  if (!ENTITIES[slug]) return { ok: false, error: "Неизвестный справочник" };
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { error } = await supabase.from(ENTITIES[slug].slug).delete().eq("id", id);
  if (error) {
    // 23503 — нарушение внешнего ключа: запись используется в учёте.
    if (error.code === "23503" || error.message.includes("foreign key")) {
      return {
        ok: false,
        fkBlocked: true,
        error: "Удалить нельзя — по этой записи уже есть данные учёта (выдачи, рейсы, смены или договоры).",
      };
    }
    return { ok: false, error: dbError("fleet/admin/actions", error) };
  }
  revalidatePath(`/fleet/admin/${slug}`);
  return { ok: true };
}
