"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { devError } from "@/lib/dev-log";

type Result = { ok: true } | { ok: false; error: string };

const zSettings = z.object({
  tanker_gap_liters: z.number().positive().max(1000),
  no_fuel_days_trips: z.number().int().min(1).max(30),
  no_fuel_days_trips_single: z.number().int().min(1).max(30),
  no_fuel_days_hours: z.number().int().min(1).max(30),
});

export async function saveDetectorSettings(input: unknown): Promise<Result> {
  const parsed = zSettings.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Проверьте значения: литры > 0, дни 1–30" };

  const current = await getCurrentProfile();
  const roles = current?.profile?.roles ?? [];
  if (!roles.includes("admin") && !roles.includes("office"))
    return { ok: false, error: "Недостаточно прав" };
  const orgId = current?.profile?.org_id;
  if (!orgId) return { ok: false, error: "Нет организации" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("org_settings")
    .upsert({ org_id: orgId, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
  if (error) {
    devError("saveDetectorSettings", error);
    return { ok: false, error: "Не удалось сохранить настройки" };
  }
  revalidatePath("/fleet/admin/settings");
  return { ok: true };
}
