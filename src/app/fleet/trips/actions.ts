"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { zUuid } from "@/lib/validation";
import { devError, IS_DEV } from "@/lib/dev-log";

type Result = { ok: true; id: string } | { ok: false; error: string };

const schema = z.object({
  route_id: zUuid,
  vehicle_id: zUuid,
  driver_id: zUuid,
  driver_signature_url: z.string().nullable(),
  geo_lat: z.number().nullable(),
  geo_lng: z.number().nullable(),
});

export async function createTrip(input: z.infer<typeof schema>): Promise<Result> {
  const p = schema.safeParse(input);
  if (!p.success) {
    const issues = p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    devError("createTrip", "валидация:", issues, input);
    return { ok: false, error: IS_DEV ? `Проверьте поля — ${issues}` : "Проверьте данные рейса" };
  }
  const d = p.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trip_records")
    .insert({
      route_id: d.route_id,
      vehicle_id: d.vehicle_id,
      driver_id: d.driver_id,
      driver_signature_url: d.driver_signature_url,
      geo_lat: d.geo_lat,
      geo_lng: d.geo_lng,
    })
    .select("id")
    .single();

  if (error) {
    devError("createTrip", "ошибка вставки:", error);
    return { ok: false, error: IS_DEV ? `БД: ${error.message}` : error.message };
  }
  revalidatePath("/fleet/trips");
  return { ok: true, id: data.id };
}

/** Отмена собственной записи (5-минутное окно проверяется RLS-политикой). */
export async function deleteTrip(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("trip_records").delete().eq("id", id);
  if (error) {
    devError("deleteTrip", error);
    return { ok: false, error: error.message };
  }
  revalidatePath("/fleet/trips");
  return { ok: true };
}
