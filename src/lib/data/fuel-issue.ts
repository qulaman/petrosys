import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { aqtobeDate } from "@/lib/tz";
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
  /**
   * Машины, которые сегодня в работе (выведены на линию, есть смена или рейс).
   * Поднимаются в начало списка: за смену заправщик трогает ~30 машин из 121,
   * и искать их среди всего парка по алфавиту — самая долгая часть выдачи.
   */
  todayVehicleIds: string[];
  /** Последняя выдача по машине — предупреждение о повторе. */
  lastIssueByVehicle: Record<string, { at: string; liters: number }>;
  /** Типовые литры по виду техники для кейпада (из истории, иначе таблица ниже). */
  presetsByType: Record<string, number[]>;
}

/**
 * Запасные пресеты по виду техники — медианный коридор p25/медиана/p75 по
 * фактическим выдачам июля 2026. Прежние общие 150/200/250/300 попадали лишь в
 * 16 % выдач: у погрузчика типовая заправка 133 л, у экскаватора — 400 л.
 * Используются, пока по виду не набралось достаточно свежей истории.
 */
const PRESET_FALLBACK: Record<string, number[]> = {
  dump_truck: [170, 220, 270],
  loader: [100, 130, 180],
  excavator: [300, 400, 500],
  grader: [160, 200, 220],
  dozer: [220, 270, 300],
  roller: [100, 120, 150],
  water_truck: [150, 200, 250],
  other: [200, 300, 400],
};

/** Меньше этого числа выдач по виду техники история недостоверна. */
const PRESET_MIN_SAMPLE = 8;

/** Пресет — круглое число: заправщик списывает литры со счётчика, а не наоборот. */
const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10);

function presetsFrom(values: number[]): number[] | null {
  if (values.length < PRESET_MIN_SAMPLE) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  // Три ступени вместо четырёх: четвёртая кнопка почти всегда дублировала соседнюю.
  const out = [...new Set([round10(at(0.25)), round10(at(0.5)), round10(at(0.75))])];
  return out.length >= 2 ? out : null;
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
  const today = aqtobeDate(new Date().toISOString());
  // Одна волна: справочники (RLS) + агрегаты (admin) не зависят друг от друга.
  const [cards, tankers, vehicles, drivers, balancesRes, historyRes, lineupsRes, shiftsRes, tripsRes] = await Promise.all([
    supabase.from("fuel_cards").select("id, card_number, operator").eq("is_active", true).order("card_number"),
    supabase.from("tankers").select("id, name, capacity_liters").eq("is_active", true).order("name"),
    supabase
      .from("vehicles")
      .select("id, brand, reg_number, vehicle_type, accounting_type, contractor_id, contract_id, qr_code, day_driver_id, night_driver_id")
      .eq("is_active", true)
      .order("reg_number"),
    supabase.from("drivers").select("id, full_name, contractor_id, contract_id").eq("is_active", true).order("full_name"),
    admin.from("tanker_balances").select("tanker_id, calculated_liters").eq("org_id", orgId),
    // Одна выборка истории на три задачи: водитель по умолчанию, предупреждение
    // о повторной заправке и типовые литры вида техники.
    admin
      .from("fuel_issues")
      .select("vehicle_id, driver_id, liters, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500),
    // План выезда на сегодня — главный признак «машина в работе» утром, когда
    // рейсов и смен ещё нет, а заправка уже идёт.
    admin
      .from("trip_lineups")
      .select("id, trip_lineup_vehicles(vehicle_id)")
      .eq("org_id", orgId)
      .eq("work_date", today),
    admin.from("shift_records").select("vehicle_id").eq("org_id", orgId).eq("shift_date", today),
    admin
      .from("trip_records")
      .select("vehicle_id")
      .eq("org_id", orgId)
      .gte("created_at", `${today}T00:00:00+05:00`),
  ]);

  const balances: Record<string, number> = {};
  for (const b of (balancesRes.data ?? []) as { tanker_id: string; calculated_liters: number }[]) {
    balances[b.tanker_id] = Number(b.calculated_liters);
  }

  const vehicleList = (vehicles.data ?? []) as Vehicle[];
  const typeById = new Map(vehicleList.map((v) => [v.id, v.vehicle_type]));

  const history = (historyRes.data ?? []) as {
    vehicle_id: string; driver_id: string; liters: number; created_at: string;
  }[];
  const lastDriverByVehicle: Record<string, string> = {};
  const lastIssueByVehicle: Record<string, { at: string; liters: number }> = {};
  const litersByType = new Map<string, number[]>();
  for (const r of history) {
    // История отсортирована по убыванию — первая встреченная запись и есть последняя.
    if (!(r.vehicle_id in lastDriverByVehicle)) lastDriverByVehicle[r.vehicle_id] = r.driver_id;
    if (!(r.vehicle_id in lastIssueByVehicle)) {
      lastIssueByVehicle[r.vehicle_id] = { at: r.created_at, liters: Number(r.liters) };
    }
    const type = typeById.get(r.vehicle_id);
    if (type) (litersByType.get(type) ?? litersByType.set(type, []).get(type))!.push(Number(r.liters));
  }

  const presetsByType: Record<string, number[]> = {};
  for (const [type, fallback] of Object.entries(PRESET_FALLBACK)) {
    presetsByType[type] = presetsFrom(litersByType.get(type) ?? []) ?? fallback;
  }

  // Сегодня в работе: план выезда + смены + уже записанные рейсы.
  const todayIds = new Set<string>();
  for (const l of (lineupsRes.data ?? []) as { trip_lineup_vehicles: { vehicle_id: string }[] | null }[]) {
    for (const v of l.trip_lineup_vehicles ?? []) todayIds.add(v.vehicle_id);
  }
  for (const s of (shiftsRes.data ?? []) as { vehicle_id: string }[]) todayIds.add(s.vehicle_id);
  for (const t of (tripsRes.data ?? []) as { vehicle_id: string }[]) todayIds.add(t.vehicle_id);

  return {
    orgId,
    cards: (cards.data ?? []) as FuelCard[],
    tankers: (tankers.data ?? []) as Tanker[],
    vehicles: vehicleList,
    drivers: (drivers.data ?? []) as Driver[],
    balances,
    lastDriverByVehicle,
    todayVehicleIds: [...todayIds],
    lastIssueByVehicle,
    presetsByType,
  };
}
