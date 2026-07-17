import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface ContractListRow {
  id: string;
  number: string;
  contractor: string;
  contract_type: string;
  billing_period: string;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
}

export async function loadContractsList(): Promise<ContractListRow[]> {
  const supabase = await createClient();
  const [contracts, contractors] = await Promise.all([
    supabase.from("contracts").select("id, number, contractor_id, contract_type, billing_period, valid_from, valid_to, is_active").order("number"),
    supabase.from("contractors").select("id, name"),
  ]);
  const cMap = new Map((contractors.data ?? []).map((c) => [c.id, c.name]));
  return (contracts.data ?? []).map((c) => ({
    id: c.id,
    number: c.number,
    contractor: cMap.get(c.contractor_id) ?? "—",
    contract_type: c.contract_type,
    billing_period: c.billing_period,
    valid_from: c.valid_from,
    valid_to: c.valid_to,
    is_active: c.is_active,
  }));
}

export interface PriceRow {
  id: string;
  vehicle_type: string;
  unit: string;
  price: number;
  vehicle_id: string | null;
  valid_from: string;
  note: string | null;
}
export interface FuelPriceRow {
  id: string;
  price_per_liter: number;
  valid_from: string;
  note: string | null;
}
export interface ContractDetail {
  contract: {
    id: string;
    contractor_id: string;
    number: string;
    contract_type: string;
    billing_period: string;
    valid_from: string;
    valid_to: string | null;
    is_active: boolean;
  };
  contractorName: string;
  contractors: { id: string; name: string }[];
  vehicles: { id: string; reg_number: string; vehicle_type: string }[];
  prices: PriceRow[];
  fuelPrices: FuelPriceRow[];
}

export async function loadContractDetail(id: string): Promise<ContractDetail | null> {
  const supabase = await createClient();
  const { data: contract } = await supabase
    .from("contracts")
    .select("id, contractor_id, number, contract_type, billing_period, valid_from, valid_to, is_active")
    .eq("id", id)
    .single();
  if (!contract) return null;

  const [{ data: contractors }, { data: vehicles }, { data: prices }, { data: fuelPrices }] =
    await Promise.all([
      supabase.from("contractors").select("id, name").order("name"),
      supabase.from("vehicles").select("id, reg_number, vehicle_type").eq("contract_id", id).order("reg_number"),
      supabase.from("price_list").select("id, vehicle_type, unit, price, vehicle_id, valid_from, note").eq("contract_id", id).order("valid_from", { ascending: false }),
      supabase.from("contract_fuel_prices").select("id, price_per_liter, valid_from, note").eq("contract_id", id).order("valid_from", { ascending: false }),
    ]);

  const cName = (contractors ?? []).find((c) => c.id === contract.contractor_id)?.name ?? "—";

  return {
    contract,
    contractorName: cName,
    contractors: (contractors ?? []) as { id: string; name: string }[],
    vehicles: (vehicles ?? []) as { id: string; reg_number: string; vehicle_type: string }[],
    prices: (prices ?? []).map((p) => ({ ...p, price: Number(p.price) })) as PriceRow[],
    fuelPrices: (fuelPrices ?? []).map((f) => ({ ...f, price_per_liter: Number(f.price_per_liter) })) as FuelPriceRow[],
  };
}
