import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * Общая логика денег для расчёта по договору (settlement.ts) и вкладки
 * «Подрядчики и деньги» дашборда (dashboard.ts). Правила см. [[business-rules]]:
 * effective-dated ставки, деньги считают только закрытые журналы смен.
 */
type Db = Awaited<ReturnType<typeof createClient>>;

export interface RatePriceRow {
  unit: string;
  vehicle_type: string;
  vehicle_id: string | null;
  price: number;
  valid_from: string;
}

/** Разрешение ставки: точная (contract, unit, vehicle) → по виду техники; максимальный valid_from ≤ даты. */
export function resolveRate(
  prices: RatePriceRow[],
  unit: "trip" | "hour",
  vehicleId: string,
  vehicleType: string,
  date: string,
): number | null {
  const usable = prices.filter((p) => p.unit === unit && p.valid_from <= date);
  const exact = usable
    .filter((p) => p.vehicle_id === vehicleId)
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));
  if (exact.length) return Number(exact[0].price);
  const byType = usable
    .filter((p) => p.vehicle_id == null && p.vehicle_type === vehicleType)
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));
  return byType.length ? Number(byType[0].price) : null;
}

export interface FuelPriceRow {
  price: number;
  valid_from: string;
}

/** Цена ГСМ на дату выдачи: максимальный valid_from ≤ даты; null — цены нет. */
export function resolveFuelPrice(prices: FuelPriceRow[], date: string): number | null {
  const usable = prices.filter((p) => p.valid_from <= date).sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));
  return usable.length ? usable[0].price : null;
}

/**
 * Id закрытых журналов смен из переданного списка (черновики не оплачиваются;
 * записи с journal_id=null — legacy, считаются всегда). Чанки — чтобы не упереться
 * в длину URL у .in() на длинных периодах.
 */
export async function loadClosedJournalIds(supabase: Db, journalIds: string[]): Promise<Set<string>> {
  const closed = new Set<string>();
  for (let i = 0; i < journalIds.length; i += 200) {
    const chunk = journalIds.slice(i, i + 200);
    const { data } = await supabase.from("shift_journals").select("id").eq("status", "closed").in("id", chunk);
    for (const j of data ?? []) closed.add(j.id);
  }
  return closed;
}
