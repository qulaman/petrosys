import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { aqtobeDate } from "@/lib/tz";
import type { ResolvedPeriod } from "@/lib/journals/period";
import { loadClosedJournalIds, resolveFuelPrice, resolveRate, type RatePriceRow } from "@/lib/data/money";

// Реэкспорт для существующих импортёров (docx/xlsx-билдеры и т.п.).
export { resolveRate, type RatePriceRow };

export interface ContractOption {
  id: string;
  number: string;
  contractor: string;
  contract_type: string;
  billing_period: string;
}

export async function loadContractOptions(): Promise<ContractOption[]> {
  const supabase = await createClient();
  const [contracts, contractors] = await Promise.all([
    supabase.from("contracts").select("id, number, contractor_id, contract_type, billing_period").order("number"),
    supabase.from("contractors").select("id, name"),
  ]);
  const cMap = new Map((contractors.data ?? []).map((c) => [c.id, c.name]));
  return (contracts.data ?? []).map((c) => ({
    id: c.id,
    number: c.number,
    contractor: cMap.get(c.contractor_id) ?? "—",
    contract_type: c.contract_type,
    billing_period: c.billing_period,
  }));
}

export interface AccrualLine {
  reg: string;
  unit: "trip" | "hour";
  qty: number;
  rate: number;
  amount: number;
}
export interface NoRateLine {
  reg: string;
  unit: "trip" | "hour";
  qty: number;
}
export interface FuelLine {
  reg: string;
  liters: number;
  amount: number;
  priceMissing: boolean;
}
export interface PenaltyLine {
  id: string;
  reason: string;
  amount: number;
  date: string;
}
export interface Settlement {
  contract: { id: string; number: string; contract_type: string; billing_period: string };
  contractor: { name: string; vat_payer: boolean };
  period: { from: string; to: string };
  accrual: AccrualLine[];
  noRate: NoRateLine[];
  fuel: FuelLine[];
  penalties: PenaltyLine[];
  totals: {
    accrual: number;
    fuelHold: number;
    penalty: number;
    vat: number; // выделенный НДС из начисления (у плательщика)
    net: number; // к оплате
  };
}

export async function loadSettlement(
  contractId: string,
  period: ResolvedPeriod,
): Promise<Settlement | null> {
  const supabase = await createClient();

  // Волна 1 — всё, что фильтруется по contract_id напрямую, одним заходом.
  const [contractRes, pricesRes, fuelPricesRes, vehiclesRes, penaltiesRes] =
    await Promise.all([
      supabase.from("contracts").select("id, number, contract_type, billing_period, contractor_id").eq("id", contractId).single(),
      supabase.from("price_list").select("unit, vehicle_type, vehicle_id, price, valid_from").eq("contract_id", contractId),
      supabase.from("contract_fuel_prices").select("price_per_liter, valid_from").eq("contract_id", contractId),
      supabase.from("vehicles").select("id, reg_number, vehicle_type").eq("contract_id", contractId),
      supabase.from("penalties").select("id, reason, amount, penalty_date").eq("contract_id", contractId).is("settled_in_period", null),
    ]);
  const contract = contractRes.data;
  if (!contract) return null;
  const prices = pricesRes.data;
  const fuelPrices = fuelPricesRes.data;
  const vehicles = vehiclesRes.data;
  const penalties = penaltiesRes.data;

  const vehIds = (vehicles ?? []).map((v) => v.id);
  const vMap = new Map((vehicles ?? []).map((v) => [v.id, v]));
  const noVeh = vehIds.length ? vehIds : ["00000000-0000-0000-0000-000000000000"];

  // Волна 2 — записи периода по машинам договора (fetchAll — без потолка 1000 строк) + контрагент.
  const [trips, shiftsRaw, fuel, contractorRes] =
    await Promise.all([
      fetchAll((f, t) => supabase.from("trip_records").select("vehicle_id, created_at").in("vehicle_id", noVeh).gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("shift_records").select("vehicle_id, hours, shift_date, journal_id").in("vehicle_id", noVeh).gte("shift_date", period.fromDate).lte("shift_date", period.toDate).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("fuel_issues").select("vehicle_id, liters, created_at").in("vehicle_id", noVeh).gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
      supabase.from("contractors").select("name, vat_payer").eq("id", contract.contractor_id).single(),
    ]);
  const contractor = contractorRes.data;

  // В расчёт идут только смены из ЗАКРЫТЫХ журналов (черновики не оплачиваются).
  // Записи без журнала (созданные до ввода журналов) считаются для совместимости.
  const journalIds = [...new Set(shiftsRaw.map((s) => s.journal_id).filter((x): x is string => !!x))];
  const closedJournals = await loadClosedJournalIds(supabase, journalIds);
  const shifts = shiftsRaw.filter(
    (s) => !s.journal_id || closedJournals.has(s.journal_id),
  );

  const priceRows = (prices ?? []) as RatePriceRow[];
  const fuelPriceRows = (fuelPrices ?? []).map((p) => ({ price: Number(p.price_per_liter), valid_from: p.valid_from }));

  // Начисление: группируем по (vehicle, unit, rate)
  const accMap = new Map<string, AccrualLine>();
  const noRateMap = new Map<string, NoRateLine>();

  const addAcc = (vehicleId: string, unit: "trip" | "hour", qty: number, rate: number | null) => {
    const v = vMap.get(vehicleId);
    const reg = v?.reg_number ?? "—";
    if (rate == null) {
      const k = `${vehicleId}|${unit}`;
      const cur = noRateMap.get(k) ?? { reg, unit, qty: 0 };
      cur.qty += qty;
      noRateMap.set(k, cur);
      return;
    }
    const k = `${vehicleId}|${unit}|${rate}`;
    const cur = accMap.get(k) ?? { reg, unit, qty: 0, rate, amount: 0 };
    cur.qty += qty;
    cur.amount = Math.round(cur.qty * rate * 100) / 100;
    accMap.set(k, cur);
  };

  for (const t of trips) {
    const v = vMap.get(t.vehicle_id);
    if (!v) continue;
    const date = aqtobeDate(t.created_at);
    addAcc(t.vehicle_id, "trip", 1, resolveRate(priceRows, "trip", v.id, v.vehicle_type, date));
  }
  for (const s of shifts) {
    const v = vMap.get(s.vehicle_id);
    if (!v) continue;
    addAcc(s.vehicle_id, "hour", Number(s.hours), resolveRate(priceRows, "hour", v.id, v.vehicle_type, s.shift_date));
  }

  // Удержание ГСМ
  const fuelMap = new Map<string, FuelLine>();
  for (const f of fuel) {
    const v = vMap.get(f.vehicle_id);
    const reg = v?.reg_number ?? "—";
    const date = aqtobeDate(f.created_at);
    const price = resolveFuelPrice(fuelPriceRows, date);
    const cur = fuelMap.get(f.vehicle_id) ?? { reg, liters: 0, amount: 0, priceMissing: price == null };
    cur.liters += Number(f.liters);
    if (price != null) cur.amount = Math.round(cur.liters * price * 100) / 100;
    else cur.priceMissing = true;
    fuelMap.set(f.vehicle_id, cur);
  }

  const accrual = [...accMap.values()].sort((a, b) => a.reg.localeCompare(b.reg, "ru"));
  const noRate = [...noRateMap.values()];
  const fuelLines = [...fuelMap.values()];
  const penaltyLines: PenaltyLine[] = (penalties ?? []).map((p) => ({
    id: p.id, reason: p.reason, amount: Number(p.amount), date: p.penalty_date,
  }));

  const accrualTotal = accrual.reduce((s, l) => s + l.amount, 0);
  const fuelHold = fuelLines.reduce((s, l) => s + l.amount, 0);
  const penaltyTotal = penaltyLines.reduce((s, l) => s + l.amount, 0);
  const vatPayer = contractor?.vat_payer ?? false;
  const vat = vatPayer ? Math.round((accrualTotal * 16 / 116) * 100) / 100 : 0;
  const net = Math.round((accrualTotal - fuelHold - penaltyTotal) * 100) / 100;

  return {
    contract: { id: contract.id, number: contract.number, contract_type: contract.contract_type, billing_period: contract.billing_period },
    contractor: { name: contractor?.name ?? "—", vat_payer: vatPayer },
    period: { from: period.fromDate, to: period.toDate },
    accrual,
    noRate,
    fuel: fuelLines,
    penalties: penaltyLines,
    totals: { accrual: accrualTotal, fuelHold, penalty: penaltyTotal, vat, net },
  };
}
