"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { devError } from "@/lib/dev-log";

type Result = { ok: true } | { ok: false; error: string };

const zFact = z
  .object({
    work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Неверная дата"),
    shift_type: z.enum(["day", "night"]).nullable(),
    flow: z.enum(["pit", "local", "stockpile", "prs", "total"]).nullable(),
    trips_count: z.number().int().min(0).max(5000).nullable(),
    volume_m3: z.number().min(0).max(100000).nullable(),
    day_status: z.enum(["work", "downtime_weather", "downtime_tech"]),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.day_status !== "work" || (v.flow && v.volume_m3 != null && v.volume_m3 > 0), {
    message: "Для рабочего дня укажите поток и объём",
  });

async function requireRoles(roles: string[]): Promise<string | null> {
  const current = await getCurrentProfile();
  const have = current?.profile?.roles ?? [];
  return roles.some((r) => have.includes(r)) ? null : "Недостаточно прав";
}

export async function createProductionFact(input: unknown): Promise<Result> {
  const parsed = zFact.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const denied = await requireRoles(["itr", "office", "admin"]);
  if (denied) return { ok: false, error: denied };

  const supabase = await createClient();
  const { error } = await supabase.from("production_facts").insert({
    work_date: parsed.data.work_date,
    shift_type: parsed.data.shift_type,
    flow: parsed.data.day_status === "work" ? parsed.data.flow : parsed.data.flow ?? null,
    trips_count: parsed.data.trips_count,
    volume_m3: parsed.data.day_status === "work" ? parsed.data.volume_m3 : parsed.data.volume_m3 ?? 0,
    day_status: parsed.data.day_status,
    note: parsed.data.note?.trim() || null,
  });
  if (error) {
    devError("createProductionFact", error);
    if (error.code === "23505")
      return { ok: false, error: "Такая запись уже есть (дата + смена + поток)" };
    return { ok: false, error: "Не удалось сохранить сводку" };
  }
  revalidatePath("/fleet/volume");
  revalidatePath("/fleet/dashboard");
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
  revalidatePath("/fleet/volume");
  revalidatePath("/fleet/dashboard");
  return { ok: true };
}
