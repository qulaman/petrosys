"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { devError, IS_DEV } from "@/lib/dev-log";
import { zUuid } from "@/lib/validation";

type Result = { ok: true } | { ok: false; error: string };

const refillSchema = z.object({
  tanker_id: zUuid,
  liters: z.number().positive().max(100000),
  price_per_liter: z.number().nonnegative().nullable(),
  source: z.string().max(200).nullable(),
  fuel_card_id: zUuid.nullable(),
  receipt_path: z.string().nullable(),
});

export async function createRefill(input: z.infer<typeof refillSchema>): Promise<Result> {
  const p = refillSchema.safeParse(input);
  if (!p.success) {
    const issues = p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    devError("createRefill", "валидация:", issues, input);
    return { ok: false, error: IS_DEV ? `Проверьте поля — ${issues}` : "Проверьте поля прихода" };
  }
  const d = p.data;

  const supabase = await createClient();
  const { error } = await supabase.from("tanker_refills").insert({
    tanker_id: d.tanker_id,
    liters: d.liters,
    price_per_liter: d.price_per_liter,
    source: d.source,
    fuel_card_id: d.fuel_card_id,
    receipt_photo_url: d.receipt_path,
  });
  if (error) {
    devError("createRefill", "ошибка вставки:", error);
    return { ok: false, error: IS_DEV ? `БД: ${error.message}` : error.message };
  }
  revalidatePath("/fleet/fuel/tanker");
  return { ok: true };
}

const measurementSchema = z.object({
  tanker_id: zUuid,
  measured_liters: z.number().nonnegative().max(100000),
  note: z.string().max(500).nullable(),
});

export async function createMeasurement(
  input: z.infer<typeof measurementSchema>,
): Promise<Result> {
  const p = measurementSchema.safeParse(input);
  if (!p.success) {
    const issues = p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    devError("createMeasurement", "валидация:", issues, input);
    return { ok: false, error: IS_DEV ? `Проверьте поля — ${issues}` : "Проверьте поля замера" };
  }
  const d = p.data;

  // Расчётный остаток на момент замера считаем через admin (RLS занижает агрегаты).
  const admin = createAdminClient();
  const { data: bal } = await admin
    .from("tanker_balances")
    .select("calculated_liters")
    .eq("tanker_id", d.tanker_id)
    .single();
  const calculated = Number(bal?.calculated_liters ?? 0);

  const supabase = await createClient();
  const { error } = await supabase.from("tanker_measurements").insert({
    tanker_id: d.tanker_id,
    measured_liters: d.measured_liters,
    calculated_liters: calculated,
    note: d.note,
  });
  if (error) {
    devError("createMeasurement", "ошибка вставки:", error);
    return { ok: false, error: IS_DEV ? `БД: ${error.message}` : error.message };
  }
  revalidatePath("/fleet/fuel/tanker");
  return { ok: true };
}
