import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/current-user";
import type { FuelCard } from "@/lib/domain";

export interface TankerInfo {
  id: string;
  name: string;
  capacity_liters: number | null;
  calculated_liters: number;
  last_measured_liters: number | null;
  last_measured_at: string | null;
}

export interface TankerEvent {
  id: string;
  kind: "refill" | "issue" | "measurement";
  at: string;
  liters: number | null; // + приход, − выдача
  measured: number | null;
  calculated: number | null;
  note: string | null;
}

export interface TankerScreenData {
  orgId: string;
  cards: FuelCard[];
  tankers: TankerInfo[];
  eventsByTanker: Record<string, TankerEvent[]>;
}

export async function loadTankerData(): Promise<TankerScreenData> {
  const current = await getCurrentProfile();
  const orgId = current?.profile?.org_id ?? "";

  const supabase = await createClient();
  // Балансы, справочник бензовозов и история — через admin (RLS занижает агрегаты).
  // Всё независимое — одной волной.
  const admin = createAdminClient();
  const [cardsRes, tankersRes, balancesRes, refillsRes, issuesRes, measRes] = await Promise.all([
    supabase.from("fuel_cards").select("id, card_number, operator").eq("is_active", true).order("card_number"),
    admin.from("tankers").select("id, name, capacity_liters").eq("org_id", orgId).eq("is_active", true).order("name"),
    admin.from("tanker_balances").select("tanker_id, calculated_liters, last_measured_liters, last_measured_at").eq("org_id", orgId),
    admin.from("tanker_refills").select("id, tanker_id, liters, created_at, source").eq("org_id", orgId).order("created_at", { ascending: false }).limit(200),
    admin.from("fuel_issues").select("id, tanker_id, liters, created_at").eq("org_id", orgId).eq("source_type", "tanker").order("created_at", { ascending: false }).limit(200),
    admin.from("tanker_measurements").select("id, tanker_id, measured_liters, calculated_liters, note, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(200),
  ]);

  const balByTanker = new Map<string, { calculated_liters: number; last_measured_liters: number | null; last_measured_at: string | null }>();
  for (const b of balancesRes.data ?? []) {
    if (!b.tanker_id) continue;
    balByTanker.set(b.tanker_id, {
      calculated_liters: Number(b.calculated_liters),
      last_measured_liters: b.last_measured_liters == null ? null : Number(b.last_measured_liters),
      last_measured_at: b.last_measured_at,
    });
  }

  const tankers: TankerInfo[] = (tankersRes.data ?? []).map((t) => {
    const b = balByTanker.get(t.id);
    return {
      id: t.id,
      name: t.name,
      capacity_liters: t.capacity_liters == null ? null : Number(t.capacity_liters),
      calculated_liters: b?.calculated_liters ?? 0,
      last_measured_liters: b?.last_measured_liters ?? null,
      last_measured_at: b?.last_measured_at ?? null,
    };
  });

  const eventsByTanker: Record<string, TankerEvent[]> = {};
  const push = (e: TankerEvent & { tanker_id: string }) => {
    (eventsByTanker[e.tanker_id] ??= []).push(e);
  };
  for (const r of refillsRes.data ?? [])
    push({ tanker_id: r.tanker_id, id: r.id, kind: "refill", at: r.created_at, liters: Number(r.liters), measured: null, calculated: null, note: r.source });
  for (const i of issuesRes.data ?? []) {
    if (!i.tanker_id) continue;
    push({ tanker_id: i.tanker_id, id: i.id, kind: "issue", at: i.created_at, liters: -Number(i.liters), measured: null, calculated: null, note: null });
  }
  for (const m of measRes.data ?? [])
    push({ tanker_id: m.tanker_id, id: m.id, kind: "measurement", at: m.created_at, liters: null, measured: Number(m.measured_liters), calculated: Number(m.calculated_liters), note: m.note });

  for (const k of Object.keys(eventsByTanker)) {
    eventsByTanker[k].sort((a, b) => (a.at < b.at ? 1 : -1));
    eventsByTanker[k] = eventsByTanker[k].slice(0, 30);
  }

  return { orgId, cards: (cardsRes.data ?? []) as FuelCard[], tankers, eventsByTanker };
}
