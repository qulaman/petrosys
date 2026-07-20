import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { aqtobeDate } from "@/lib/tz";
import type { ResolvedPeriod } from "@/lib/journals/period";
import {
  loadClosedJournalIds,
  resolveFuelPrice,
  resolveRate,
  type RatePriceRow,
} from "@/lib/data/money";

/**
 * АВР по контрагенту (ИП): формула заказчика от 20.07.2026 —
 * по каждой машине: часы × тариф(час) + рейсы × тариф(рейс) − ГСМ × цена,
 * итог по ИП = сумма итогов машин (показывается сверху). Тарифы — из договора,
 * к которому привязана машина (effective-dated, как в закрытии по договору).
 */

export interface ContractorOption {
  id: string;
  name: string;
  vehicles: number;
}

export async function loadContractorOptions(): Promise<ContractorOption[]> {
  const supabase = await createClient();
  const [contractors, vehicles] = await Promise.all([
    supabase.from("contractors").select("id, name").eq("is_active", true).order("name"),
    supabase.from("vehicles").select("contractor_id").not("contractor_id", "is", null),
  ]);
  const counts = new Map<string, number>();
  for (const v of vehicles.data ?? [])
    counts.set(v.contractor_id!, (counts.get(v.contractor_id!) ?? 0) + 1);
  return (contractors.data ?? [])
    .map((c) => ({ id: c.id, name: c.name, vehicles: counts.get(c.id) ?? 0 }))
    .filter((c) => c.vehicles > 0);
}

export interface AvrLine {
  reg: string;
  hours: number;
  hoursAmount: number;
  trips: number;
  tripsAmount: number;
  litersTanker: number;
  litersCard: number;
  fuelAmount: number;
  total: number;
  /** количества, оставшиеся без тарифа/цены — в итог не вошли */
  noRateHours: number;
  noRateTrips: number;
  fuelPriceMissing: boolean;
}

export interface AvrPenalty {
  id: string;
  reason: string;
  amount: number;
  date: string;
  contract: string;
}

export interface ContractorAvr {
  contractor: { id: string; name: string; vat_payer: boolean };
  contracts: { id: string; number: string }[];
  period: { from: string; to: string };
  lines: AvrLine[];
  totals: {
    accrual: number; // итог по ИП = Σ итогов машин (начисление − ГСМ)
    hoursAmount: number;
    tripsAmount: number;
    fuelHold: number;
    penalty: number;
    vat: number; // справочно, 16/116 из начисления
    net: number; // итог − штрафы
  };
  penalties: AvrPenalty[];
}

export async function loadContractorAvr(
  contractorId: string,
  period: ResolvedPeriod,
): Promise<ContractorAvr | null> {
  const supabase = await createClient();

  const [contractorRes, contractsRes] = await Promise.all([
    supabase.from("contractors").select("id, name, vat_payer").eq("id", contractorId).single(),
    supabase.from("contracts").select("id, number").eq("contractor_id", contractorId),
  ]);
  const contractor = contractorRes.data;
  if (!contractor) return null;
  const contracts = contractsRes.data ?? [];
  const contractIds = contracts.length ? contracts.map((c) => c.id) : ["00000000-0000-0000-0000-000000000000"];
  const contractNumber = new Map(contracts.map((c) => [c.id, c.number]));

  // Машины ИП: по прямой привязке к контрагенту или через его договоры.
  const [vehiclesRes, pricesRes, fuelPricesRes, penaltiesRes] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, reg_number, vehicle_type, contract_id")
      .or(`contractor_id.eq.${contractorId},contract_id.in.(${contractIds.join(",")})`),
    supabase.from("price_list").select("contract_id, unit, vehicle_type, vehicle_id, price, valid_from").in("contract_id", contractIds),
    supabase.from("contract_fuel_prices").select("contract_id, price_per_liter, valid_from").in("contract_id", contractIds),
    supabase.from("penalties").select("id, contract_id, reason, amount, penalty_date").in("contract_id", contractIds).is("settled_in_period", null),
  ]);
  const vehicles = vehiclesRes.data ?? [];
  const vMap = new Map(vehicles.map((v) => [v.id, v]));
  const vehIds = vehicles.length ? vehicles.map((v) => v.id) : ["00000000-0000-0000-0000-000000000000"];

  // Тарифы и цены ГСМ — по договорам ИП, при расчёте берётся договор машины.
  const pricesByContract = new Map<string, RatePriceRow[]>();
  for (const p of pricesRes.data ?? []) {
    const arr = pricesByContract.get(p.contract_id) ?? [];
    arr.push({ unit: p.unit, vehicle_type: p.vehicle_type, vehicle_id: p.vehicle_id, price: Number(p.price), valid_from: p.valid_from });
    pricesByContract.set(p.contract_id, arr);
  }
  const fuelByContract = new Map<string, { price: number; valid_from: string }[]>();
  for (const p of fuelPricesRes.data ?? []) {
    const arr = fuelByContract.get(p.contract_id) ?? [];
    arr.push({ price: Number(p.price_per_liter), valid_from: p.valid_from });
    fuelByContract.set(p.contract_id, arr);
  }

  const [trips, shiftsRaw, fuel] = await Promise.all([
    fetchAll((f, t) => supabase.from("trip_records").select("vehicle_id, created_at").in("vehicle_id", vehIds).gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
    fetchAll((f, t) => supabase.from("shift_records").select("vehicle_id, hours, shift_date, journal_id").in("vehicle_id", vehIds).gte("shift_date", period.fromDate).lte("shift_date", period.toDate).order("id").range(f, t)),
    fetchAll((f, t) => supabase.from("fuel_issues").select("vehicle_id, liters, source_type, created_at").in("vehicle_id", vehIds).gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
  ]);

  // Деньги считают только закрытые журналы (legacy-записи без журнала — считаются).
  const journalIds = [...new Set(shiftsRaw.map((s) => s.journal_id).filter((x): x is string => !!x))];
  const closedJournals = await loadClosedJournalIds(supabase, journalIds);
  const shifts = shiftsRaw.filter((s) => !s.journal_id || closedJournals.has(s.journal_id));

  const lineMap = new Map<string, AvrLine>();
  const line = (vehicleId: string): AvrLine => {
    let l = lineMap.get(vehicleId);
    if (!l) {
      l = {
        reg: vMap.get(vehicleId)?.reg_number ?? "—",
        hours: 0, hoursAmount: 0, trips: 0, tripsAmount: 0,
        litersTanker: 0, litersCard: 0, fuelAmount: 0, total: 0,
        noRateHours: 0, noRateTrips: 0, fuelPriceMissing: false,
      };
      lineMap.set(vehicleId, l);
    }
    return l;
  };
  const r2 = (x: number) => Math.round(x * 100) / 100;

  for (const s of shifts) {
    const v = vMap.get(s.vehicle_id);
    if (!v) continue;
    const l = line(s.vehicle_id);
    const hours = Number(s.hours);
    const rate = v.contract_id
      ? resolveRate(pricesByContract.get(v.contract_id) ?? [], "hour", v.id, v.vehicle_type, s.shift_date)
      : null;
    l.hours = r2(l.hours + hours);
    if (rate == null) l.noRateHours = r2(l.noRateHours + hours);
    else l.hoursAmount = r2(l.hoursAmount + hours * rate);
  }
  for (const t of trips) {
    const v = vMap.get(t.vehicle_id);
    if (!v) continue;
    const l = line(t.vehicle_id);
    const date = aqtobeDate(t.created_at);
    const rate = v.contract_id
      ? resolveRate(pricesByContract.get(v.contract_id) ?? [], "trip", v.id, v.vehicle_type, date)
      : null;
    l.trips += 1;
    if (rate == null) l.noRateTrips += 1;
    else l.tripsAmount = r2(l.tripsAmount + rate);
  }
  for (const f of fuel) {
    const v = vMap.get(f.vehicle_id);
    if (!v) continue;
    const l = line(f.vehicle_id);
    const liters = Number(f.liters);
    if (f.source_type === "tanker") l.litersTanker = r2(l.litersTanker + liters);
    else l.litersCard = r2(l.litersCard + liters);
    const price = v.contract_id
      ? resolveFuelPrice(fuelByContract.get(v.contract_id) ?? [], aqtobeDate(f.created_at))
      : null;
    if (price == null) l.fuelPriceMissing = true;
    else l.fuelAmount = r2(l.fuelAmount + liters * price);
  }

  const lines = [...lineMap.values()]
    .map((l) => ({ ...l, total: r2(l.hoursAmount + l.tripsAmount - l.fuelAmount) }))
    .sort((a, b) => a.reg.localeCompare(b.reg, "ru"));

  const penalties: AvrPenalty[] = (penaltiesRes.data ?? []).map((p) => ({
    id: p.id, reason: p.reason, amount: Number(p.amount), date: p.penalty_date,
    contract: contractNumber.get(p.contract_id) ?? "—",
  }));

  const hoursAmount = r2(lines.reduce((s, l) => s + l.hoursAmount, 0));
  const tripsAmount = r2(lines.reduce((s, l) => s + l.tripsAmount, 0));
  const fuelHold = r2(lines.reduce((s, l) => s + l.fuelAmount, 0));
  const accrual = r2(lines.reduce((s, l) => s + l.total, 0));
  const penalty = r2(penalties.reduce((s, p) => s + p.amount, 0));
  const vat = contractor.vat_payer ? r2((hoursAmount + tripsAmount) * 16 / 116) : 0;

  return {
    contractor: { id: contractor.id, name: contractor.name, vat_payer: contractor.vat_payer },
    contracts,
    period: { from: period.fromDate, to: period.toDate },
    lines,
    totals: { accrual, hoursAmount, tripsAmount, fuelHold, penalty, vat, net: r2(accrual - penalty) },
    penalties,
  };
}
