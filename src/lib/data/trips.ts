import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/current-user";
import type { Driver, Vehicle } from "@/lib/domain";

export interface RouteOption {
  id: string;
  name: string;
  require_signature: boolean;
}

export interface RecentTrip {
  id: string;
  at: string;
  vehicle_id: string;
  driver_id: string;
}

export interface TripsScreenData {
  orgId: string;
  routes: RouteOption[];
  vehicles: Vehicle[]; // только самосвалы (accounting_type='trips')
  drivers: Driver[];
  lastDriverByVehicle: Record<string, string>;
  recentTrips: RecentTrip[];
}

export async function loadTripsData(): Promise<TripsScreenData> {
  const current = await getCurrentProfile();
  const orgId = current?.profile?.org_id ?? "";

  const supabase = await createClient();
  const [routesRes, vehiclesRes, driversRes, recentRes] = await Promise.all([
    supabase.from("routes").select("id, name, require_signature").eq("is_active", true).order("name"),
    supabase
      .from("vehicles")
      .select("id, brand, reg_number, vehicle_type, accounting_type, contractor_id, contract_id, qr_code")
      .eq("is_active", true)
      .eq("accounting_type", "trips")
      .order("reg_number"),
    supabase.from("drivers").select("id, full_name, contractor_id, contract_id").eq("is_active", true).order("full_name"),
    supabase
      .from("trip_records")
      .select("id, created_at, vehicle_id, driver_id")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const admin = createAdminClient();
  const lastDriverRes = await admin
    .from("trip_records")
    .select("vehicle_id, driver_id")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(300);

  const lastDriverByVehicle: Record<string, string> = {};
  for (const r of lastDriverRes.data ?? []) {
    if (r.vehicle_id && r.driver_id && !(r.vehicle_id in lastDriverByVehicle)) {
      lastDriverByVehicle[r.vehicle_id] = r.driver_id;
    }
  }

  return {
    orgId,
    routes: (routesRes.data ?? []) as RouteOption[],
    vehicles: (vehiclesRes.data ?? []) as Vehicle[],
    drivers: (driversRes.data ?? []) as Driver[],
    lastDriverByVehicle,
    recentTrips: (recentRes.data ?? []).map((t) => ({
      id: t.id,
      at: t.created_at,
      vehicle_id: t.vehicle_id,
      driver_id: t.driver_id,
    })),
  };
}
