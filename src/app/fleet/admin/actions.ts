"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ENTITIES } from "@/lib/admin/registry";

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

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/fleet/admin/${slug}`);
  return { ok: true };
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
    return { ok: false, error: error.message };
  }
  revalidatePath(`/fleet/admin/${slug}`);
  return { ok: true };
}
