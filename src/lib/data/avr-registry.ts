import "server-only";
import { createClient } from "@/lib/supabase/server";
import { aqtobeToday } from "@/lib/tz";
import { resolveFuelPrice, resolveRate, type RatePriceRow } from "@/lib/data/money";

/**
 * Справочник АВР: плоский взгляд заказчика поверх контрагентов/договоров/прайсов —
 * ИП | НДС | тип | номер | час | рейс | ГСМ | водители | действует с | документ.
 * Версии условий — все, актуальная помечена (движок и так считает по актуальной).
 * Типы и подписи — в @/lib/avr-registry-shared (общие с клиентом).
 */
import type {
  DocType,
  RateVersion,
  RegistryData,
  RegistryGroup,
  UnassignedVehicle,
} from "@/lib/avr-registry-shared";

export type { RegistryData };

export async function loadAvrRegistry(): Promise<RegistryData> {
  const supabase = await createClient();
  const today = aqtobeToday();

  const [vehR, ctrR, conR, drvR, plR, fpR] = await Promise.all([
    supabase.from("vehicles")
      .select("id, reg_number, vehicle_type, contractor_id, contract_id, day_driver_id, night_driver_id")
      .eq("is_active", true).order("reg_number"),
    supabase.from("contractors").select("id, name, vat_payer").eq("is_active", true).order("name"),
    supabase.from("contracts").select("id, number, contractor_id"),
    supabase.from("drivers").select("id, full_name").order("full_name"),
    supabase.from("price_list").select("contract_id, unit, vehicle_type, vehicle_id, price, valid_from, doc_type"),
    supabase.from("contract_fuel_prices").select("contract_id, price_per_liter, valid_from, doc_type"),
  ]);

  const contractors = ctrR.data ?? [];
  const contracts = conR.data ?? [];
  const drivers = drvR.data ?? [];
  const ctrById = new Map(contractors.map((c) => [c.id, c]));
  const conById = new Map(contracts.map((c) => [c.id, c]));
  const drvById = new Map(drivers.map((d) => [d.id, d.full_name]));

  const plByContract = new Map<string, (RatePriceRow & { doc_type: string | null })[]>();
  for (const p of plR.data ?? []) {
    const arr = plByContract.get(p.contract_id) ?? [];
    arr.push({ unit: p.unit, vehicle_type: p.vehicle_type, vehicle_id: p.vehicle_id, price: Number(p.price), valid_from: p.valid_from, doc_type: p.doc_type });
    plByContract.set(p.contract_id, arr);
  }
  const fpByContract = new Map<string, { price: number; valid_from: string; doc_type: string | null }[]>();
  for (const p of fpR.data ?? []) {
    const arr = fpByContract.get(p.contract_id) ?? [];
    arr.push({ price: Number(p.price_per_liter), valid_from: p.valid_from, doc_type: p.doc_type });
    fpByContract.set(p.contract_id, arr);
  }

  const groups = new Map<string, RegistryGroup>();
  const unassigned: UnassignedVehicle[] = [];

  for (const v of vehR.data ?? []) {
    const contractorId = v.contractor_id ?? (v.contract_id ? conById.get(v.contract_id)?.contractor_id : null) ?? null;
    if (!contractorId || !v.contract_id) {
      unassigned.push({ id: v.id, reg_number: v.reg_number, vehicle_type: v.vehicle_type, reason: "нет ИП или договора" });
      continue;
    }
    const contractor = ctrById.get(contractorId);
    const prices = (plByContract.get(v.contract_id) ?? []).filter(
      (p) => p.vehicle_id === v.id || (p.vehicle_id == null && p.vehicle_type === v.vehicle_type),
    );
    const fuels = fpByContract.get(v.contract_id) ?? [];

    // версии = все даты начала действия среди тарифов и цен ГСМ машины
    const dates = [...new Set([...prices.map((p) => p.valid_from), ...fuels.map((f) => f.valid_from)])].sort();
    const versions: RateVersion[] = dates.map((d) => ({
      valid_from: d,
      hour: resolveRate(prices, "hour", v.id, v.vehicle_type, d),
      trip: resolveRate(prices, "trip", v.id, v.vehicle_type, d),
      fuel: resolveFuelPrice(fuels, d),
      doc_type: ((prices.find((p) => p.valid_from === d)?.doc_type ??
        fuels.find((f) => f.valid_from === d)?.doc_type) ?? null) as DocType | null,
      current: false,
    }));
    const cur = [...versions].reverse().find((x) => x.valid_from <= today);
    if (cur) cur.current = true;

    if (!versions.length || !versions.some((x) => x.current && (x.hour != null || x.trip != null))) {
      unassigned.push({ id: v.id, reg_number: v.reg_number, vehicle_type: v.vehicle_type, reason: "нет действующего тарифа" });
    }

    let g = groups.get(contractorId);
    if (!g) {
      g = { contractor_id: contractorId, contractor: contractor?.name ?? "—", vat_payer: contractor?.vat_payer ?? false, vehicles: [] };
      groups.set(contractorId, g);
    }
    g.vehicles.push({
      id: v.id,
      reg_number: v.reg_number,
      vehicle_type: v.vehicle_type,
      contract_number: conById.get(v.contract_id)?.number ?? null,
      day_driver: v.day_driver_id ? drvById.get(v.day_driver_id) ?? null : null,
      night_driver: v.night_driver_id ? drvById.get(v.night_driver_id) ?? null : null,
      versions: versions.reverse(), // свежие сверху
    });
  }

  return {
    groups: [...groups.values()].sort((a, b) => a.contractor.localeCompare(b.contractor, "ru")),
    unassigned,
    contractors: contractors.map((c) => ({ id: c.id, name: c.name, vat_payer: c.vat_payer })),
    contracts: contracts.map((c) => ({ id: c.id, number: c.number, contractor_id: c.contractor_id })),
    drivers: drivers.map((d) => ({ id: d.id, full_name: d.full_name })),
  };
}
