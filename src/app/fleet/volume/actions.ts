"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { devError } from "@/lib/dev-log";

type Result = { ok: true } | { ok: false; error: string };
type Db = Awaited<ReturnType<typeof createClient>>;

const zFactBase = z.object({
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Неверная дата"),
  shift_type: z.enum(["day", "night"]).nullable(),
  flow: z.enum(["pit", "local", "stockpile", "prs", "total"]).nullable(),
  trips_count: z.number().int().min(0).max(5000).nullable(),
  volume_m3: z.number().min(0).max(100000).nullable(),
  day_status: z.enum(["work", "downtime_weather", "downtime_tech"]),
  note: z.string().max(500).nullable().optional(),
});

/** Рабочий день без потока и объёма — не сводка, а пустая строка в прогнозе. */
const workDayFilled = (v: z.infer<typeof zFactBase>) =>
  v.day_status !== "work" || Boolean(v.flow && v.volume_m3 != null && v.volume_m3 > 0);
const FILLED_MSG = { message: "Для рабочего дня укажите поток и объём" };

const zFact = zFactBase.refine(workDayFilled, FILLED_MSG);
const zFactUpdate = zFactBase.extend({ id: z.string().min(30) }).refine(workDayFilled, FILLED_MSG);

type FactInput = z.infer<typeof zFactBase>;

async function requireRoles(roles: string[]): Promise<string | null> {
  const current = await getCurrentProfile();
  const have = current?.profile?.roles ?? [];
  return roles.some((r) => have.includes(r)) ? null : "Недостаточно прав";
}

/** Поля записи в том виде, в каком они уходят в БД (простой обнуляет объём). */
function factRow(d: FactInput) {
  return {
    work_date: d.work_date,
    shift_type: d.shift_type,
    flow: d.flow,
    trips_count: d.trips_count,
    volume_m3: d.day_status === "work" ? d.volume_m3 : (d.volume_m3 ?? 0),
    day_status: d.day_status,
    note: d.note?.trim() || null,
  };
}

/**
 * Прогноз складывает ВСЕ записи за дату, поэтому суточная сводка и сменные по
 * одному потоку дают двойной объём. Уникальный индекс их не ловит (сутки и
 * смена — разные ключи), проверяем сами.
 */
async function shiftMixError(
  supabase: Db,
  d: FactInput,
  excludeId?: string,
): Promise<string | null> {
  if (!d.flow || !((d.volume_m3 ?? 0) > 0)) return null;
  let q = supabase
    .from("production_facts")
    .select("id, shift_type")
    .eq("work_date", d.work_date)
    .eq("flow", d.flow)
    .gt("volume_m3", 0);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;
  const hasDaily = (data ?? []).some((r) => r.shift_type == null);
  const hasShift = (data ?? []).some((r) => r.shift_type != null);
  if (d.shift_type && hasDaily)
    return "За эту дату и поток уже есть сводка «за сутки» — сменная удвоит объём в прогнозе";
  if (!d.shift_type && hasShift)
    return "За эту дату и поток уже есть сводки по сменам — суточная удвоит объём в прогнозе";
  return null;
}

function refresh() {
  revalidatePath("/fleet/volume");
  revalidatePath("/fleet/journals/volume");
  revalidatePath("/fleet/dashboard");
}

export async function createProductionFact(input: unknown): Promise<Result> {
  const parsed = zFact.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const denied = await requireRoles(["itr", "office", "admin"]);
  if (denied) return { ok: false, error: denied };

  const supabase = await createClient();
  const mix = await shiftMixError(supabase, parsed.data);
  if (mix) return { ok: false, error: mix };

  const { error } = await supabase.from("production_facts").insert(factRow(parsed.data));
  if (error) {
    devError("createProductionFact", error);
    if (error.code === "23505")
      return { ok: false, error: "Такая запись уже есть (дата + смена + поток)" };
    return { ok: false, error: "Не удалось сохранить сводку" };
  }
  refresh();
  return { ok: true };
}

/** Правка сводки — офис/админ (RLS на production_facts разрешает им же). */
export async function updateProductionFact(input: unknown): Promise<Result> {
  const parsed = zFactUpdate.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const denied = await requireRoles(["office", "admin"]);
  if (denied) return { ok: false, error: denied };
  const { id, ...d } = parsed.data;

  const supabase = await createClient();
  const mix = await shiftMixError(supabase, d, id);
  if (mix) return { ok: false, error: mix };

  const { data, error } = await supabase
    .from("production_facts")
    .update(factRow(d))
    .eq("id", id)
    .select("id");
  if (error) {
    devError("updateProductionFact", error);
    if (error.code === "23505")
      return { ok: false, error: "Такая запись уже есть (дата + смена + поток)" };
    return { ok: false, error: "Не удалось сохранить правку" };
  }
  if (!data?.length) return { ok: false, error: "Запись не найдена или нет прав на правку" };
  refresh();
  return { ok: true };
}

export async function deleteProductionFact(id: string): Promise<Result> {
  const parsed = z.string().min(30).safeParse(id);
  if (!parsed.success) return { ok: false, error: "Неверный id" };
  const denied = await requireRoles(["itr", "office", "admin"]);
  if (denied) return { ok: false, error: denied };

  const supabase = await createClient();
  const { error } = await supabase.from("production_facts").delete().eq("id", parsed.data);
  if (error) {
    devError("deleteProductionFact", error);
    return { ok: false, error: "Не удалось удалить запись" };
  }
  refresh();
  return { ok: true };
}
