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


export interface LineupInfo {
  id: string;
  work_date: string;
  shift_type: "day" | "night";
  status: "open" | "closed";
}

export interface PreviousLineup extends LineupInfo {
  vehicleCount: number;
}

export interface TripsScreenData {
  orgId: string;
  date: string;
  shift: "day" | "night";
  routes: RouteOption[];
  vehicles: Vehicle[]; // техника с учётом рейсов (accounting_type trips/both)
  drivers: Driver[];
  lastDriverByVehicle: Record<string, string>;
  /** Перечень «на линии» текущей смены (этап 1) и его машины. */
  lineup: LineupInfo | null;
  lineupVehicleIds: string[];
  /** Кандидат на наследование, когда перечня на смену ещё нет. */
  previous: PreviousLineup | null;
  /** Рейсы текущей смены по машинам: счётчик и время последнего (для плиток). */
  shiftStats: Record<string, { count: number; lastAt: string }>;
  /** Все рейсы карточки смены (для экрана проверки: удаление конкретных). */
  shiftTrips: { id: string; vehicle_id: string; driver_id: string; at: string }[];
  /** Текущий пользователь может переоткрывать закрытые карточки (офис/админ). */
  canReopen: boolean;
}

/** Границы смены в поясе Asia/Aqtobe (UTC+5): день 07–19, ночь 19–07. */
function shiftWindow(workDate: string, shift: "day" | "night") {
  const nextDay = new Date(`${workDate}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const next = nextDay.toISOString().slice(0, 10);
  const from = shift === "day" ? `${workDate}T07:00:00+05:00` : `${workDate}T19:00:00+05:00`;
  const to = shift === "day" ? `${workDate}T19:00:00+05:00` : `${next}T07:00:00+05:00`;
  return { fromISO: new Date(from).toISOString(), toISO: new Date(to).toISOString() };
}

export async function loadTripsData(
  date: string,
  shift: "day" | "night",
): Promise<TripsScreenData> {
  const current = await getCurrentProfile();
  const orgId = current?.profile?.org_id ?? "";

  const supabase = await createClient();
  const [routesRes, vehiclesRes, driversRes, lineupRes] = await Promise.all([
    supabase.from("routes").select("id, name, require_signature").eq("is_active", true).order("name"),
    supabase
      .from("vehicles")
      .select("id, brand, reg_number, vehicle_type, accounting_type, contractor_id, contract_id, qr_code, day_driver_id, night_driver_id")
      .eq("is_active", true)
      .in("accounting_type", ["trips", "both"])
      .order("reg_number"),
    supabase.from("drivers").select("id, full_name, contractor_id, contract_id").eq("is_active", true).order("full_name"),
    supabase
      .from("trip_lineups")
      .select("id, work_date, shift_type, status")
      .eq("work_date", date)
      .eq("shift_type", shift)
      .maybeSingle(),
  ]);

  const lineup = (lineupRes.data as LineupInfo | null) ?? null;

  // Вторая волна: машины перечня, история водителей, кандидат на наследование,
  // рейсы текущей смены (счётчики на плитках).
  const w = shiftWindow(date, shift);
  const admin = createAdminClient();
  const [lineupVehRes, lastDriverRes, prevRes, shiftTripsRes] = await Promise.all([
    lineup
      ? supabase.from("trip_lineup_vehicles").select("vehicle_id").eq("lineup_id", lineup.id)
      : Promise.resolve({ data: null }),
    admin
      .from("trip_records")
      .select("vehicle_id, driver_id")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(300),
    !lineup
      ? supabase
          .from("trip_lineups")
          .select("id, work_date, shift_type, status")
          .or(`work_date.lt.${date},and(work_date.eq.${date},shift_type.eq.day)`)
          .order("work_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("trip_records")
      .select("id, vehicle_id, driver_id, created_at, tapped_at")
      .gte("created_at", w.fromISO)
      .lt("created_at", w.toISO)
      .order("created_at"),
  ]);

  // Источник наследования (самонаследование той же смены исключаем).
  let previous: PreviousLineup | null = null;
  const prev = prevRes.data as LineupInfo | null;
  if (prev && !(prev.work_date === date && prev.shift_type === shift)) {
    const { count } = await supabase
      .from("trip_lineup_vehicles")
      .select("id", { count: "exact", head: true })
      .eq("lineup_id", prev.id);
    previous = { ...prev, vehicleCount: count ?? 0 };
  }

  const lastDriverByVehicle: Record<string, string> = {};
  for (const r of lastDriverRes.data ?? []) {
    if (r.vehicle_id && r.driver_id && !(r.vehicle_id in lastDriverByVehicle)) {
      lastDriverByVehicle[r.vehicle_id] = r.driver_id;
    }
  }

  // Время рейса — момент тапа учётчика (tapped_at); created_at — время доставки
  // на сервер, используется как фолбэк для старых записей.
  const shiftStats: Record<string, { count: number; lastAt: string }> = {};
  for (const t of shiftTripsRes.data ?? []) {
    const at = t.tapped_at ?? t.created_at;
    const s = shiftStats[t.vehicle_id] ?? { count: 0, lastAt: at };
    s.count += 1;
    if (at > s.lastAt) s.lastAt = at;
    shiftStats[t.vehicle_id] = s;
  }

  return {
    orgId,
    date,
    shift,
    routes: (routesRes.data ?? []) as RouteOption[],
    vehicles: (vehiclesRes.data ?? []) as Vehicle[],
    drivers: (driversRes.data ?? []) as Driver[],
    lastDriverByVehicle,
    lineup,
    lineupVehicleIds: (lineupVehRes.data ?? []).map((r: { vehicle_id: string }) => r.vehicle_id),
    previous,
    shiftStats,
    shiftTrips: (shiftTripsRes.data ?? [])
      .map((t) => ({
        id: t.id,
        vehicle_id: t.vehicle_id,
        driver_id: t.driver_id,
        at: t.tapped_at ?? t.created_at,
      }))
      .sort((a, b) => (a.at < b.at ? -1 : 1)),
    canReopen: ["office", "admin"].some((r) => current?.profile?.roles.includes(r)),
  };
}
