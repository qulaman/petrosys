import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/current-user";
import type {
  Driver,
  FuelCard,
  Tanker,
  Vehicle,
} from "@/lib/domain";

export interface FuelIssueData {
  orgId: string;
  cards: FuelCard[];
  tankers: Tanker[];
  vehicles: Vehicle[];
  drivers: Driver[];
  balances: Record<string, number>; // tanker_id -> расчётный остаток
  lastDriverByVehicle: Record<string, string>; // vehicle_id -> driver_id
}

/**
 * Данные для экрана выдачи топлива. Балансы бензовозов и «последний водитель»
 * считаются через admin (service_role), т.к. под RLS заправщик видит только
 * свои записи — агрегаты по бензовозу были бы занижены.
 */
export async function loadFuelIssueData(): Promise<FuelIssueData> {
  const current = await getCurrentProfile();
  const orgId = current?.profile?.org_id ?? "";

  const supabase = await createClient();
  const admin = createAdminClient();
  // Одна волна: справочники (RLS) + агрегаты (admin) не зависят друг от друга.
  const [cards, tankers, vehicles, drivers, balancesRes, lastDriverRes] = await Promise.all([
    supabase.from("fuel_cards").select("id, card_number, operator").eq("is_active", true).order("card_number"),
    supabase.from("tankers").select("id, name, capacity_liters").eq("is_active", true).order("name"),
    supabase
      .from("vehicles")
      .select("id, brand, reg_number, vehicle_type, accounting_type, contractor_id, contract_id, qr_code, day_driver_id, night_driver_id")
      .eq("is_active", true)
      .order("reg_number"),
    supabase.from("drivers").select("id, full_name, contractor_id, contract_id").eq("is_active", true).order("full_name"),
    admin.from("tanker_balances").select("tanker_id, calculated_liters").eq("org_id", orgId),
    admin
      .from("fuel_issues")
      .select("vehicle_id, driver_id")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(300), // последних записей достаточно для автоподстановки водителя
  ]);

  const balances: Record<string, number> = {};
  for (const b of (balancesRes.data ?? []) as { tanker_id: string; calculated_liters: number }[]) {
    balances[b.tanker_id] = Number(b.calculated_liters);
  }

  const lastDriverByVehicle: Record<string, string> = {};
  for (const r of (lastDriverRes.data ?? []) as { vehicle_id: string; driver_id: string }[]) {
    if (!(r.vehicle_id in lastDriverByVehicle)) {
      lastDriverByVehicle[r.vehicle_id] = r.driver_id;
    }
  }

  return {
    orgId,
    cards: (cards.data ?? []) as FuelCard[],
    tankers: (tankers.data ?? []) as Tanker[],
    vehicles: (vehicles.data ?? []) as Vehicle[],
    drivers: (drivers.data ?? []) as Driver[],
    balances,
    lastDriverByVehicle,
  };
}
