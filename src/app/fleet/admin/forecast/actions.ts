"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { devError } from "@/lib/dev-log";

type Result = { ok: true } | { ok: false; error: string };

const zSettings = z.object({
  baseline_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Неверная дата якоря"),
  baseline_volume_m3: z.number().min(0).max(100_000_000),
  target_volume_m3: z.number().positive().max(100_000_000),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  trucks_per_excavator: z.number().int().min(1).max(100),
  availability_coeff: z.number().min(0.1).max(1),
  trips_per_truck_shift: z.number().int().min(1).max(100),
});

export async function saveForecastSettings(input: unknown): Promise<Result> {
  const parsed = zSettings.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Проверьте значения" };

  const current = await getCurrentProfile();
  const roles = current?.profile?.roles ?? [];
  if (!roles.includes("admin") && !roles.includes("office"))
    return { ok: false, error: "Недостаточно прав" };
  const orgId = current?.profile?.org_id;
  if (!orgId) return { ok: false, error: "Нет организации" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("forecast_settings")
    .upsert({ org_id: orgId, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
  if (error) {
    devError("saveForecastSettings", error);
    return { ok: false, error: "Не удалось сохранить параметры" };
  }
  revalidatePath("/fleet/admin/forecast");
  revalidatePath("/fleet/dashboard");
  return { ok: true };
}
