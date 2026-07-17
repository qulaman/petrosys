import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { ANOMALY_LABELS, PENALTY_TYPES } from "@/lib/anomalies";
import { AnomaliesClient, type AnomalyRow } from "./anomalies-client";

type Refs = Record<string, unknown>;

function summarize(
  type: string,
  refs: Refs,
  vMap: Map<string, string>,
  dMap: Map<string, string>,
): string {
  const reg = () => vMap.get(String(refs.vehicle_id ?? "")) ?? "машина";
  const drv = () => dMap.get(String(refs.driver_id ?? "")) ?? "водитель";
  switch (type) {
    case "fuel_no_work":
      return `${reg()}: топливо ${refs.liters} л, работы нет · ${refs.date}`;
    case "hours_over_11":
      return `${reg()}: ${refs.hours} ч · ${refs.date}`;
    case "driver_double_shift":
      return `${drv()}: день+ночь · ${refs.date}`;
    case "tanker_gap":
      return `Бензовоз: расхождение ${refs.diff} л`;
    case "unapproved_unit":
      return `${reg()}: вне периода допуска · ${refs.date}`;
    case "over_norm":
      return `${reg()}: ${refs.actual} л/ч > норма ${refs.norm} · ${refs.month}`;
    default:
      return JSON.stringify(refs);
  }
}

export default async function AnomaliesPage() {
  const supabase = await createClient();
  const [anomalies, veh, drv] = await Promise.all([
    supabase.from("anomalies").select("id, type, severity, status, detected_at, entity_refs").order("detected_at", { ascending: false }).limit(500),
    supabase.from("vehicles").select("id, reg_number"),
    supabase.from("drivers").select("id, full_name"),
  ]);

  const vMap = new Map((veh.data ?? []).map((v) => [v.id, v.reg_number]));
  const dMap = new Map((drv.data ?? []).map((d) => [d.id, d.full_name]));

  const rows: AnomalyRow[] = (anomalies.data ?? []).map((a) => ({
    id: a.id,
    type: a.type,
    typeLabel: ANOMALY_LABELS[a.type] ?? a.type,
    severity: a.severity,
    status: a.status as AnomalyRow["status"],
    detected_at: a.detected_at,
    summary: summarize(a.type, (a.entity_refs ?? {}) as Refs, vMap, dMap),
    canPenalty: PENALTY_TYPES.has(a.type),
  }));

  return (
    <AppShell requiredRoles={["admin", "office"]} title="Центр аномалий">
      <AnomaliesClient rows={rows} />
    </AppShell>
  );
}
