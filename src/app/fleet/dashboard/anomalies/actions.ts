"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { devError } from "@/lib/dev-log";

type Result = { ok: true; count?: number } | { ok: false; error: string };

function aqtobeToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Aqtobe",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function recomputeAction(): Promise<Result> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recompute_anomalies");
  if (error) {
    devError("recomputeAnomalies", error);
    return { ok: false, error: error.message };
  }
  revalidatePath("/fleet/dashboard/anomalies");
  return { ok: true, count: data ?? 0 };
}

export async function updateAnomalyStatus(
  id: string,
  status: "new" | "reviewed" | "confirmed" | "dismissed",
  note: string | null,
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("anomalies")
    .update({ status, resolution_note: note, reviewed_by: user?.id ?? null })
    .eq("id", id);
  if (error) {
    devError("updateAnomalyStatus", error);
    return { ok: false, error: error.message };
  }
  revalidatePath("/fleet/dashboard/anomalies");
  return { ok: true };
}

/** Конвертация подтверждённой аномалии в штраф (договор берётся от машины). */
export async function createPenaltyFromAnomaly(
  anomalyId: string,
  amount: number,
  reason: string,
): Promise<Result> {
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("anomalies")
    .select("type, entity_refs")
    .eq("id", anomalyId)
    .single();

  const refs = (a?.entity_refs ?? {}) as { vehicle_id?: string };
  if (!refs.vehicle_id) return { ok: false, error: "Нет привязки к машине" };

  const { data: v } = await supabase
    .from("vehicles")
    .select("contract_id")
    .eq("id", refs.vehicle_id)
    .single();
  if (!v?.contract_id) return { ok: false, error: "У машины не задан договор" };

  const { error } = await supabase.from("penalties").insert({
    contract_id: v.contract_id,
    amount,
    reason,
    penalty_date: aqtobeToday(),
  });
  if (error) {
    devError("createPenaltyFromAnomaly", error);
    return { ok: false, error: error.message };
  }

  // Помечаем аномалию подтверждённой (если ещё нет).
  await supabase.from("anomalies").update({ status: "confirmed" }).eq("id", anomalyId);
  revalidatePath("/fleet/dashboard/anomalies");
  return { ok: true };
}
