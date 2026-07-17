import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface JournalFilters {
  fromISO: string;
  toISO: string;
  fromDate: string;
  toDate: string;
  vehicleId?: string | null;
  contractorId?: string | null;
}

export interface FilterOptions {
  vehicles: { id: string; reg_number: string }[];
  contractors: { id: string; name: string }[];
  drivers: { id: string; full_name: string }[];
  routes: { id: string; name: string }[];
}

export async function loadFilterOptions(): Promise<FilterOptions> {
  const supabase = await createClient();
  const [v, c, d, r] = await Promise.all([
    supabase.from("vehicles").select("id, reg_number").order("reg_number"),
    supabase.from("contractors").select("id, name").order("name"),
    supabase.from("drivers").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("routes").select("id, name").eq("is_active", true).order("name"),
  ]);
  return {
    vehicles: (v.data ?? []) as FilterOptions["vehicles"],
    contractors: (c.data ?? []) as FilterOptions["contractors"],
    drivers: (d.data ?? []) as FilterOptions["drivers"],
    routes: (r.data ?? []) as FilterOptions["routes"],
  };
}

// --- вспомогалки ---
/** Фильтр по подрядчику через уже загруженный словарь техники — без лишнего RTT. */
function byContractor<T extends { vehicle_id: string }>(
  rows: T[],
  contractorId: string | null | undefined,
  vehicles: { id: string; contractor_id: string | null }[],
): T[] {
  if (!contractorId) return rows;
  const ids = new Set(vehicles.filter((v) => v.contractor_id === contractorId).map((v) => v.id));
  return rows.filter((r) => ids.has(r.vehicle_id));
}

// =============================== ГСМ ===============================
export interface FuelJournalRow {
  id: string;
  at: string;
  reg: string;
  brand: string;
  driver: string;
  driver_id: string;
  liters: number;
  source: "card" | "tanker";
  source_name: string;
  odometer: number | null;
  receipt_path: string | null;
  signature_path: string;
}

export async function loadFuelJournal(f: JournalFilters): Promise<FuelJournalRow[]> {
  const supabase = await createClient();

  let q = supabase
    .from("fuel_issues")
    .select("id, created_at, liters, source_type, odometer, receipt_photo_url, driver_signature_url, vehicle_id, driver_id, fuel_card_id, tanker_id")
    .gte("created_at", f.fromISO)
    .lt("created_at", f.toISO)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);

  // Словари и основная выборка — одной волной; фильтр подрядчика — в JS.
  const [veh, drv, cards, tankers, rowsRes] = await Promise.all([
    supabase.from("vehicles").select("id, reg_number, brand, contractor_id"),
    supabase.from("drivers").select("id, full_name"),
    supabase.from("fuel_cards").select("id, card_number"),
    supabase.from("tankers").select("id, name"),
    q,
  ]);
  const vMap = new Map((veh.data ?? []).map((v) => [v.id, v]));
  const dMap = new Map((drv.data ?? []).map((d) => [d.id, d.full_name]));
  const cMap = new Map((cards.data ?? []).map((c) => [c.id, c.card_number]));
  const tMap = new Map((tankers.data ?? []).map((t) => [t.id, t.name]));

  const data = byContractor(rowsRes.data ?? [], f.contractorId, veh.data ?? []);
  return data.map((r) => {
    const v = vMap.get(r.vehicle_id);
    const src = r.source_type as "card" | "tanker";
    return {
      id: r.id,
      at: r.created_at,
      reg: v?.reg_number ?? "—",
      brand: v?.brand ?? "",
      driver: dMap.get(r.driver_id) ?? "—",
      driver_id: r.driver_id,
      liters: Number(r.liters),
      source: src,
      source_name:
        src === "card"
          ? cMap.get(r.fuel_card_id ?? "") ?? "Карта"
          : tMap.get(r.tanker_id ?? "") ?? "Бензовоз",
      odometer: r.odometer == null ? null : Number(r.odometer),
      receipt_path: r.receipt_photo_url,
      signature_path: r.driver_signature_url,
    };
  });
}

// =============================== РЕЙСЫ ===============================
export interface TripJournalRow {
  id: string;
  at: string;
  reg: string;
  driver: string;
  driver_id: string;
  route: string;
  route_id: string;
  has_signature: boolean;
  geo: string | null;
}

export async function loadTripJournal(f: JournalFilters): Promise<TripJournalRow[]> {
  const supabase = await createClient();

  let q = supabase
    .from("trip_records")
    .select("id, created_at, vehicle_id, driver_id, route_id, driver_signature_url, geo_lat, geo_lng")
    .gte("created_at", f.fromISO)
    .lt("created_at", f.toISO)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);

  const [veh, drv, routes, rowsRes] = await Promise.all([
    supabase.from("vehicles").select("id, reg_number, contractor_id"),
    supabase.from("drivers").select("id, full_name"),
    supabase.from("routes").select("id, name"),
    q,
  ]);
  const vMap = new Map((veh.data ?? []).map((v) => [v.id, v]));
  const dMap = new Map((drv.data ?? []).map((d) => [d.id, d.full_name]));
  const rMap = new Map((routes.data ?? []).map((r) => [r.id, r.name]));

  const data = byContractor(rowsRes.data ?? [], f.contractorId, veh.data ?? []);
  return data.map((r) => ({
    id: r.id,
    at: r.created_at,
    reg: vMap.get(r.vehicle_id)?.reg_number ?? "—",
    driver: dMap.get(r.driver_id) ?? "—",
    driver_id: r.driver_id,
    route: rMap.get(r.route_id) ?? "—",
    route_id: r.route_id,
    has_signature: !!r.driver_signature_url,
    geo: r.geo_lat != null && r.geo_lng != null ? `${r.geo_lat}, ${r.geo_lng}` : null,
  }));
}

// =============================== СМЕНЫ ===============================
export interface ShiftJournalRow {
  id: string;
  date: string;
  shift: "day" | "night";
  reg: string;
  driver: string;
  hours: number;
  work_type: string;
  driver_signature_path: string | null;
  itr_signature_path: string | null;
}

export async function loadShiftJournal(f: JournalFilters): Promise<ShiftJournalRow[]> {
  const supabase = await createClient();

  let q = supabase
    .from("shift_records")
    .select("id, shift_date, shift_type, hours, vehicle_id, driver_id, work_type_id, driver_signature_url, itr_signature_url")
    .gte("shift_date", f.fromDate)
    .lte("shift_date", f.toDate)
    .order("shift_date", { ascending: false })
    .limit(5000);
  if (f.vehicleId) q = q.eq("vehicle_id", f.vehicleId);

  const [veh, drv, wt, rowsRes] = await Promise.all([
    supabase.from("vehicles").select("id, reg_number, contractor_id"),
    supabase.from("drivers").select("id, full_name"),
    supabase.from("work_types").select("id, name"),
    q,
  ]);
  const vMap = new Map((veh.data ?? []).map((v) => [v.id, v]));
  const dMap = new Map((drv.data ?? []).map((d) => [d.id, d.full_name]));
  const wMap = new Map((wt.data ?? []).map((w) => [w.id, w.name]));

  const data = byContractor(rowsRes.data ?? [], f.contractorId, veh.data ?? []);
  return data.map((r) => ({
    id: r.id,
    date: r.shift_date,
    shift: r.shift_type as "day" | "night",
    reg: vMap.get(r.vehicle_id)?.reg_number ?? "—",
    driver: dMap.get(r.driver_id) ?? "—",
    hours: Number(r.hours),
    work_type: r.work_type_id ? wMap.get(r.work_type_id) ?? "—" : "—",
    driver_signature_path: r.driver_signature_url,
    itr_signature_path: r.itr_signature_url,
  }));
}
