"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { devError, devLog, IS_DEV } from "@/lib/dev-log";
import { zUuid } from "@/lib/validation";

const schema = z.object({
  source_type: z.enum(["card", "tanker"]),
  fuel_card_id: zUuid.nullable(),
  tanker_id: zUuid.nullable(),
  vehicle_id: zUuid,
  driver_id: zUuid,
  liters: z.number().positive().max(100000),
  odometer: z.number().nonnegative().nullable(),
  receipt_path: z.string().nullable(),
  signature_path: z.string().min(1),
  // геолокация больше не собирается; поля оставлены для совместимости outbox
  geo_lat: z.number().nullable().optional(),
  geo_lng: z.number().nullable().optional(),
});

export type CreateFuelIssueInput = z.infer<typeof schema>;

export type CreateFuelIssueResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createFuelIssue(
  input: CreateFuelIssueInput,
): Promise<CreateFuelIssueResult> {
  devLog("createFuelIssue", "input:", input);

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    devError("createFuelIssue", "валидация не прошла:", issues, parsed.error.flatten());
    return {
      ok: false,
      error: IS_DEV ? `Проверьте поля — ${issues}` : "Проверьте заполнение полей",
    };
  }
  const d = parsed.data;

  if (d.source_type === "card" && !d.fuel_card_id)
    return { ok: false, error: "Не выбрана топливная карта" };
  if (d.source_type === "tanker" && !d.tanker_id)
    return { ok: false, error: "Не выбран бензовоз" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fuel_issues")
    .insert({
      source_type: d.source_type,
      fuel_card_id: d.source_type === "card" ? d.fuel_card_id : null,
      tanker_id: d.source_type === "tanker" ? d.tanker_id : null,
      vehicle_id: d.vehicle_id,
      driver_id: d.driver_id,
      liters: d.liters,
      odometer: d.odometer,
      receipt_photo_url: d.receipt_path,
      driver_signature_url: d.signature_path,
      geo_lat: d.geo_lat ?? null,
      geo_lng: d.geo_lng ?? null,
    })
    .select("id")
    .single();

  if (error) {
    devError("createFuelIssue", "ошибка вставки:", error);
    return { ok: false, error: IS_DEV ? `БД: ${error.message}` : error.message };
  }
  devLog("createFuelIssue", "успех, id:", data.id);
  return { ok: true, id: data.id };
}
