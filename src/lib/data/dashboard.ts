import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { resolvePeriod, type ResolvedPeriod } from "@/lib/journals/period";
import { loadClosedJournalIds, resolveFuelPrice, resolveRate, type RatePriceRow } from "@/lib/data/money";
import { aqtobeDate } from "@/lib/tz";

export type EventKind = "fuel" | "trip" | "shift";

export interface FeedEvent {
  id: string;
  kind: EventKind;
  at: string;
  vehicle_id: string;
  driver_id: string;
  detail: string; // «200 л · карта» / «рейс» / «10 ч»
}

export interface TankerBalanceRow {
  tanker_id: string;
  name: string;
  calculated_liters: number;
  last_measured_at: string | null;
  stale: boolean; // > 7 дней без замера
}

export interface AttentionItem {
  id: string;
  type: string;
  detected_at: string;
  reg: string | null;
}
export interface GeoPoint {
  kind: "fuel" | "trip";
  reg: string;
  at: string;
  lat: number;
  lng: number;
}

export interface TodayData {
  orgId: string;
  date: string;
  /** Машины с записью сегодня — клиент дополняет из realtime-событий. */
  onlineVehicleIds: string[];
  techTotal: number;
  tripsToday: number;
  hoursToday: number;
  litersCard: number;
  litersTanker: number;
  /** Вчерашние значения для Δ — до того же часа, что и сейчас (сравнение сопоставимо). */
  prev: { trips: number; hours: number; liters: number };
  attention: AttentionItem[];
  geoPoints: GeoPoint[];
  recentEvents: FeedEvent[];
  tankerBalances: TankerBalanceRow[];
  vehicleNames: Record<string, string>;
  driverNames: Record<string, string>;
}

export async function loadTodayData(): Promise<TodayData> {
  const current = await getCurrentProfile();
  const orgId = current?.profile?.org_id ?? "";
  const period = resolvePeriod({ period: "today" });

  // Вчера для Δ: окно [вчера 00:00; сейчас − 24ч) — неполный сегодня
  // сравнивается с тем же отрезком вчерашнего дня, а не с полными сутками.
  const prevDate = new Date(`${period.fromDate}T00:00:00Z`);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const prevFromDate = prevDate.toISOString().slice(0, 10);
  const prevFromISO = `${prevFromDate}T00:00:00+05:00`;
  const prevCutISO = new Date(Date.now() - 864e5).toISOString();

  const supabase = await createClient();
  const admin = createAdminClient();
  // Одна волна: пользовательские выборки + admin-агрегаты (зависят только от orgId).
  const [veh, drv, fuelRows, tripRows, shiftRows, prevFuel, prevTrips, prevShifts, attentionRes, balRes, tankersRes] =
    await Promise.all([
      supabase.from("vehicles").select("id, reg_number, is_active"),
      supabase.from("drivers").select("id, full_name"),
      fetchAll((f, t) => supabase.from("fuel_issues").select("id, created_at, liters, source_type, vehicle_id, driver_id, geo_lat, geo_lng").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("trip_records").select("id, created_at, vehicle_id, driver_id, geo_lat, geo_lng").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("shift_records").select("id, created_at, vehicle_id, driver_id, hours").eq("shift_date", period.fromDate).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("fuel_issues").select("liters").gte("created_at", prevFromISO).lt("created_at", prevCutISO).order("id").range(f, t)),
      supabase.from("trip_records").select("id", { count: "exact", head: true }).gte("created_at", prevFromISO).lt("created_at", prevCutISO),
      fetchAll((f, t) => supabase.from("shift_records").select("hours").eq("shift_date", prevFromDate).lt("created_at", prevCutISO).order("id").range(f, t)),
      supabase.from("anomalies").select("id, type, detected_at, entity_refs").eq("status", "new").order("detected_at", { ascending: false }).limit(5),
      admin.from("tanker_balances").select("tanker_id, calculated_liters, last_measured_at").eq("org_id", orgId),
      admin.from("tankers").select("id, name").eq("org_id", orgId).eq("is_active", true),
    ]);

  const vehicleNames: Record<string, string> = {};
  for (const v of veh.data ?? []) vehicleNames[v.id] = v.reg_number;
  const driverNames: Record<string, string> = {};
  for (const d of drv.data ?? []) driverNames[d.id] = d.full_name;

  const online = new Set<string>();
  for (const r of fuelRows) online.add(r.vehicle_id);
  for (const r of tripRows) online.add(r.vehicle_id);
  for (const r of shiftRows) online.add(r.vehicle_id);

  let litersCard = 0;
  let litersTanker = 0;
  for (const r of fuelRows) {
    if (r.source_type === "card") litersCard += Number(r.liters);
    else litersTanker += Number(r.liters);
  }
  const hoursToday = shiftRows.reduce((s, r) => s + Number(r.hours), 0);

  const events: FeedEvent[] = [
    ...fuelRows.map((r) => ({
      id: r.id, kind: "fuel" as const, at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id,
      detail: `${Number(r.liters)} л · ${r.source_type === "card" ? "карта" : "бензовоз"}`,
    })),
    ...tripRows.map((r) => ({
      id: r.id, kind: "trip" as const, at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id, detail: "рейс",
    })),
    ...shiftRows.map((r) => ({
      id: r.id, kind: "shift" as const, at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id, detail: `${Number(r.hours)} ч`,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 25);

  const nameById = new Map((tankersRes.data ?? []).map((t) => [t.id, t.name]));
  const now = Date.now();
  const tankerBalances: TankerBalanceRow[] = (balRes.data ?? [])
    .filter((b) => b.tanker_id && nameById.has(b.tanker_id))
    .map((b) => ({
      tanker_id: b.tanker_id as string,
      name: nameById.get(b.tanker_id as string) ?? "",
      calculated_liters: Number(b.calculated_liters),
      last_measured_at: b.last_measured_at,
      stale: !b.last_measured_at || now - new Date(b.last_measured_at).getTime() > 7 * 864e5,
    }));

  // Δ ко вчера (к этому часу)
  const prev = {
    trips: prevTrips.count ?? 0,
    hours: prevShifts.reduce((s, r) => s + Number(r.hours), 0),
    liters: prevFuel.reduce((s, r) => s + Number(r.liters), 0),
  };

  // «Требует внимания» — свежие аномалии с привязкой к машине.
  const attention: AttentionItem[] = (attentionRes.data ?? []).map((a) => {
    const refs = (a.entity_refs ?? {}) as { vehicle_id?: string };
    return {
      id: a.id,
      type: a.type,
      detected_at: a.detected_at,
      reg: refs.vehicle_id ? vehicleNames[refs.vehicle_id] ?? null : null,
    };
  });

  // Последние гео-точки записей (учёт идёт по всему объекту).
  const geoPoints: GeoPoint[] = [
    ...fuelRows.filter((r) => r.geo_lat != null && r.geo_lng != null).map((r) => ({
      kind: "fuel" as const, reg: vehicleNames[r.vehicle_id] ?? "—", at: r.created_at,
      lat: Number(r.geo_lat), lng: Number(r.geo_lng),
    })),
    ...tripRows.filter((r) => r.geo_lat != null && r.geo_lng != null).map((r) => ({
      kind: "trip" as const, reg: vehicleNames[r.vehicle_id] ?? "—", at: r.created_at,
      lat: Number(r.geo_lat), lng: Number(r.geo_lng),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);

  return {
    orgId,
    date: period.fromDate,
    onlineVehicleIds: [...online],
    techTotal: (veh.data ?? []).filter((v) => v.is_active).length,
    tripsToday: tripRows.length,
    hoursToday,
    litersCard,
    litersTanker,
    prev,
    attention,
    geoPoints,
    recentEvents: events,
    tankerBalances,
    vehicleNames,
    driverNames,
  };
}

// =============================== ВКЛАДКА «ТОПЛИВО» ===============================
export interface DailyIssue {
  label: string; // dd.mm
  card: number;
  tanker: number;
}
export interface NormRow {
  vehicle_id: string;
  reg: string;
  actual: number; // л/моточас факт
  norm: number | null;
  over: boolean;
}
export interface TopConsumer {
  vehicle_id: string;
  reg: string;
  liters: number;
}
export interface FuelTabData {
  daily: DailyIssue[];
  norm: NormRow[];
  top: TopConsumer[];
}

function eachDay(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  let d = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 864e5);
  }
  return out;
}

const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

export async function loadFuelTabData(period: ResolvedPeriod): Promise<FuelTabData> {
  const supabase = await createClient();
  const [veh, fuelRows, shiftRows] = await Promise.all([
    supabase.from("vehicles").select("id, reg_number, fuel_norm_per_hour, accounting_type"),
    fetchAll((f, t) => supabase.from("fuel_issues").select("created_at, liters, source_type, vehicle_id").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
    fetchAll((f, t) => supabase.from("shift_records").select("vehicle_id, hours").gte("shift_date", period.fromDate).lte("shift_date", period.toDate).order("id").range(f, t)),
  ]);

  const vMap = new Map((veh.data ?? []).map((v) => [v.id, v]));

  // 1) выдачи по дням
  const byDay = new Map<string, { card: number; tanker: number }>();
  for (const r of fuelRows) {
    const day = aqtobeDate(r.created_at);
    const cur = byDay.get(day) ?? { card: 0, tanker: 0 };
    if (r.source_type === "card") cur.card += Number(r.liters);
    else cur.tanker += Number(r.liters);
    byDay.set(day, cur);
  }
  const daily: DailyIssue[] = eachDay(period.fromDate, period.toDate).map((d) => {
    const c = byDay.get(d) ?? { card: 0, tanker: 0 };
    return { label: ddmm(d), card: c.card, tanker: c.tanker };
  });

  // 2) расход к нормативу (техника на моточасах)
  const litersByVeh = new Map<string, number>();
  for (const r of fuelRows) litersByVeh.set(r.vehicle_id, (litersByVeh.get(r.vehicle_id) ?? 0) + Number(r.liters));
  const hoursByVeh = new Map<string, number>();
  for (const r of shiftRows) hoursByVeh.set(r.vehicle_id, (hoursByVeh.get(r.vehicle_id) ?? 0) + Number(r.hours));

  const norm: NormRow[] = [];
  for (const v of veh.data ?? []) {
    if (v.accounting_type !== "hours") continue;
    const hours = hoursByVeh.get(v.id) ?? 0;
    const liters = litersByVeh.get(v.id) ?? 0;
    if (hours <= 0 && liters <= 0) continue;
    const actual = hours > 0 ? Math.round((liters / hours) * 10) / 10 : 0;
    const normVal = v.fuel_norm_per_hour == null ? null : Number(v.fuel_norm_per_hour);
    norm.push({ vehicle_id: v.id, reg: v.reg_number, actual, norm: normVal, over: normVal != null && actual > normVal });
  }
  norm.sort((a, b) => b.actual - a.actual);

  // 3) топ потребителей
  const top: TopConsumer[] = [...litersByVeh.entries()]
    .map(([id, liters]) => ({ vehicle_id: id, reg: vMap.get(id)?.reg_number ?? "—", liters }))
    .sort((a, b) => b.liters - a.liters)
    .slice(0, 10);

  return { daily, norm, top };
}

// =============================== ВКЛАДКА «РАБОТА» ===============================
export interface HeatRow { reg: string; cells: number[]; total: number }
export interface IntervalBucket { label: string; count: number }
/** Гистограмма интервалов: reg=null — все самосвалы разом. */
export interface IntervalGroup { reg: string | null; buckets: IntervalBucket[]; median: number | null }
export interface ProductivityRow { reg: string; avgPerDay: number }
export interface WorkTabData {
  /** Подписи колонок: дни (dd.mm) или недели (с dd.mm) при периоде > 60 дней. */
  days: string[];
  weekly: boolean;
  /** Техника на моточасах: часы по дням + итог за период. */
  hoursRows: HeatRow[];
  maxHoursCell: number;
  /** Самосвалы: рейсы по дням + итог за период. */
  tripsRows: HeatRow[];
  maxTripsCell: number;
  /** Интервалы между рейсами: общая группа + по каждой машине. */
  intervals: IntervalGroup[];
  /** Выработка самосвалов: рейсов в день против медианы парка. */
  productivity: ProductivityRow[];
  productivityMedian: number | null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const INTERVAL_BUCKETS: [string, (m: number) => boolean][] = [
  ["<15", (m) => m < 15], ["15–30", (m) => m >= 15 && m < 30], ["30–45", (m) => m >= 30 && m < 45],
  ["45–60", (m) => m >= 45 && m < 60], ["60–90", (m) => m >= 60 && m < 90], ["90–120", (m) => m >= 90 && m < 120],
  [">120", (m) => m >= 120],
];

function toIntervalGroup(reg: string | null, intervals: number[]): IntervalGroup {
  return {
    reg,
    buckets: INTERVAL_BUCKETS.map(([label, fn]) => ({ label, count: intervals.filter(fn).length })),
    median: median(intervals),
  };
}

export async function loadWorkTabData(period: ResolvedPeriod): Promise<WorkTabData> {
  const supabase = await createClient();
  const [veh, trips, shifts] = await Promise.all([
    supabase.from("vehicles").select("id, reg_number, accounting_type").eq("is_active", true).order("reg_number"),
    fetchAll((f, t) => supabase.from("trip_records").select("vehicle_id, created_at").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
    fetchAll((f, t) => supabase.from("shift_records").select("vehicle_id, hours, shift_date").gte("shift_date", period.fromDate).lte("shift_date", period.toDate).order("id").range(f, t)),
  ]);

  const allDays = eachDay(period.fromDate, period.toDate);
  // > 60 дней — по дням нечитаемо и тяжело: агрегируем колонки в недели.
  const weekly = allDays.length > 60;
  const buckets: { label: string; days: string[] }[] = weekly
    ? Array.from({ length: Math.ceil(allDays.length / 7) }, (_, i) => {
        const chunk = allDays.slice(i * 7, i * 7 + 7);
        return { label: `с ${ddmm(chunk[0])}`, days: chunk };
      })
    : allDays.map((d) => ({ label: ddmm(d), days: [d] }));

  // agg maps: `${vehicle}|${day}` -> value
  const tripCount = new Map<string, number>();
  for (const t of trips) {
    const k = `${t.vehicle_id}|${aqtobeDate(t.created_at)}`;
    tripCount.set(k, (tripCount.get(k) ?? 0) + 1);
  }
  const hoursSum = new Map<string, number>();
  for (const s of shifts) {
    const k = `${s.vehicle_id}|${s.shift_date}`;
    hoursSum.set(k, (hoursSum.get(k) ?? 0) + Number(s.hours));
  }

  // Часы и рейсы — раздельно: своя таблица и своя шкала подсветки.
  let maxHoursCell = 0;
  let maxTripsCell = 0;
  const hoursRows: HeatRow[] = [];
  const tripsRows: HeatRow[] = [];
  for (const v of veh.data ?? []) {
    const isTrips = v.accounting_type === "trips";
    const src = isTrips ? tripCount : hoursSum;
    const cells = buckets.map((b) => {
      const val = b.days.reduce((s, d) => s + (src.get(`${v.id}|${d}`) ?? 0), 0);
      if (isTrips) { if (val > maxTripsCell) maxTripsCell = val; }
      else if (val > maxHoursCell) maxHoursCell = val;
      return Math.round(val * 10) / 10;
    });
    const total = Math.round(cells.reduce((s, n) => s + n, 0) * 10) / 10;
    (isTrips ? tripsRows : hoursRows).push({ reg: v.reg_number, cells, total });
  }

  // Интервалы между рейсами: ходки каждой машины по дню, разницы в минутах.
  const tripsByVehDay = new Map<string, number[]>();
  for (const t of trips) {
    const k = `${t.vehicle_id}|${aqtobeDate(t.created_at)}`;
    (tripsByVehDay.get(k) ?? tripsByVehDay.set(k, []).get(k))!.push(new Date(t.created_at).getTime());
  }
  const intervalsByVeh = new Map<string, number[]>();
  const allIntervals: number[] = [];
  for (const [key, times] of tripsByVehDay) {
    const vehicleId = key.slice(0, key.indexOf("|"));
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const m = Math.round((times[i] - times[i - 1]) / 60000);
      allIntervals.push(m);
      (intervalsByVeh.get(vehicleId) ?? intervalsByVeh.set(vehicleId, []).get(vehicleId))!.push(m);
    }
  }
  const regById = new Map((veh.data ?? []).map((v) => [v.id, v.reg_number]));
  const intervals: IntervalGroup[] = [
    toIntervalGroup(null, allIntervals),
    ...[...intervalsByVeh.entries()]
      .map(([id, xs]) => ({ reg: regById.get(id) ?? "—", xs }))
      .sort((a, b) => a.reg.localeCompare(b.reg, "ru"))
      .map(({ reg, xs }) => toIntervalGroup(reg, xs)),
  ];

  // Выработка самосвалов: среднее рейсов за активный день; медиана по парку.
  const productivity: ProductivityRow[] = (veh.data ?? [])
    .filter((v) => v.accounting_type === "trips")
    .map((v) => {
      const perDay = allDays.map((d) => tripCount.get(`${v.id}|${d}`) ?? 0).filter((n) => n > 0);
      const avg = perDay.length ? Math.round((perDay.reduce((s, n) => s + n, 0) / perDay.length) * 10) / 10 : 0;
      return { reg: v.reg_number, avgPerDay: avg };
    })
    .filter((p) => p.avgPerDay > 0)
    .sort((a, b) => b.avgPerDay - a.avgPerDay);

  return {
    days: buckets.map((b) => b.label),
    weekly,
    hoursRows,
    maxHoursCell: Math.max(1, maxHoursCell),
    tripsRows,
    maxTripsCell: Math.max(1, maxTripsCell),
    intervals,
    productivity,
    productivityMedian: median(productivity.map((p) => p.avgPerDay)),
  };
}

// =========================== ВКЛАДКА «ПОДРЯДЧИКИ И ДЕНЬГИ» ===========================
export interface ContractMoney {
  id: string;
  number: string;
  contractor: string;
  contract_type: string;
  accrual: number;
  fuelHold: number;
  penalty: number;
  net: number;
  forecast: number;
  tripsCount: number;
  hoursSum: number;
  /** Эффективная стоимость: net/рейс и net/час (сравнение подрядчиков). */
  costPerTrip: number | null;
  costPerHour: number | null;
  /** Тенге за м³ перевезённого грунта (объём — из маршрута). */
  tengePerM3: number | null;
}
export interface MoneyTabData {
  contracts: ContractMoney[];
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 864e5);
}

/**
 * Батч-расчёт денег по ВСЕМ договорам за 2 волны параллельных запросов
 * (раньше — loadSettlement в цикле: ~700 мс × число договоров последовательно).
 * Логика идентична loadSettlement (общие хелперы в lib/data/money.ts):
 * effective-dated ставки, ГСМ по дате выдачи, только закрытые журналы смен,
 * непогашенные штрафы.
 */
export async function loadMoneyTabData(period: ResolvedPeriod): Promise<MoneyTabData> {
  const supabase = await createClient();
  const today = resolvePeriod({ period: "today" }).fromDate;
  const totalDays = daysBetween(period.fromDate, period.toDate) + 1;
  const clampedEnd = today < period.toDate ? (today < period.fromDate ? period.fromDate : today) : period.toDate;
  const elapsed = Math.max(1, daysBetween(period.fromDate, clampedEnd) + 1);

  // Волна 1 — всё независимое, по всей организации разом.
  const [contractsRes, contractorsRes, vehiclesRes, prices, fuelPricesRes, trips, shiftsRows, fuelRows, penaltiesRes, routesRes] =
    await Promise.all([
      supabase.from("contracts").select("id, number, contract_type, contractor_id"),
      supabase.from("contractors").select("id, name, vat_payer"),
      supabase.from("vehicles").select("id, vehicle_type, contract_id"),
      fetchAll((f, t) => supabase.from("price_list").select("contract_id, unit, vehicle_type, vehicle_id, price, valid_from").order("id").range(f, t)),
      supabase.from("contract_fuel_prices").select("contract_id, price_per_liter, valid_from"),
      fetchAll((f, t) => supabase.from("trip_records").select("vehicle_id, created_at, route_id").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("shift_records").select("vehicle_id, hours, shift_date, journal_id").gte("shift_date", period.fromDate).lte("shift_date", period.toDate).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("fuel_issues").select("vehicle_id, liters, created_at").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
      supabase.from("penalties").select("contract_id, amount").is("settled_in_period", null),
      supabase.from("routes").select("id, volume_m3"),
    ]);
  const routeVolume = new Map((routesRes.data ?? []).map((r) => [r.id, r.volume_m3 == null ? null : Number(r.volume_m3)]));

  // Волна 2 — статусы журналов смен (оплачиваются только закрытые).
  const journalIds = [...new Set(shiftsRows.map((s) => s.journal_id).filter((x): x is string => !!x))];
  const closedJournals = await loadClosedJournalIds(supabase, journalIds);

  const contractorById = new Map((contractorsRes.data ?? []).map((c) => [c.id, c]));
  const vehById = new Map((vehiclesRes.data ?? []).map((v) => [v.id, v]));
  const pricesByContract = new Map<string, RatePriceRow[]>();
  for (const p of prices) {
    if (!p.contract_id) continue;
    (pricesByContract.get(p.contract_id) ?? pricesByContract.set(p.contract_id, []).get(p.contract_id))!
      .push({ unit: p.unit, vehicle_type: p.vehicle_type, vehicle_id: p.vehicle_id, price: Number(p.price), valid_from: p.valid_from });
  }
  const fuelPricesByContract = new Map<string, { price: number; valid_from: string }[]>();
  for (const f of fuelPricesRes.data ?? []) {
    if (!f.contract_id) continue;
    (fuelPricesByContract.get(f.contract_id) ?? fuelPricesByContract.set(f.contract_id, []).get(f.contract_id))!
      .push({ price: Number(f.price_per_liter), valid_from: f.valid_from });
  }

  // Агрегация начислений/удержаний по договорам одним проходом.
  const acc = new Map<string, { accrual: number; fuelHold: number; penalty: number; trips: number; hours: number; volume: number }>();
  const bucket = (cid: string) => {
    let b = acc.get(cid);
    if (!b) { b = { accrual: 0, fuelHold: 0, penalty: 0, trips: 0, hours: 0, volume: 0 }; acc.set(cid, b); }
    return b;
  };

  for (const t of trips) {
    const v = vehById.get(t.vehicle_id);
    if (!v?.contract_id) continue;
    const b = bucket(v.contract_id);
    b.trips += 1;
    b.volume += routeVolume.get(t.route_id) ?? 0;
    const rate = resolveRate(pricesByContract.get(v.contract_id) ?? [], "trip", v.id, v.vehicle_type, aqtobeDate(t.created_at));
    if (rate != null) b.accrual += rate;
  }
  for (const s of shiftsRows) {
    if (s.journal_id && !closedJournals.has(s.journal_id)) continue; // черновики не оплачиваются
    const v = vehById.get(s.vehicle_id);
    if (!v?.contract_id) continue;
    const b = bucket(v.contract_id);
    b.hours += Number(s.hours);
    const rate = resolveRate(pricesByContract.get(v.contract_id) ?? [], "hour", v.id, v.vehicle_type, s.shift_date);
    if (rate != null) b.accrual += rate * Number(s.hours);
  }
  for (const f of fuelRows) {
    const v = vehById.get(f.vehicle_id);
    if (!v?.contract_id) continue;
    const price = resolveFuelPrice(fuelPricesByContract.get(v.contract_id) ?? [], aqtobeDate(f.created_at));
    if (price != null) bucket(v.contract_id).fuelHold += price * Number(f.liters);
  }
  for (const p of penaltiesRes.data ?? []) {
    bucket(p.contract_id).penalty += Number(p.amount);
  }

  const contracts: ContractMoney[] = (contractsRes.data ?? []).map((c) => {
    const b = acc.get(c.id) ?? { accrual: 0, fuelHold: 0, penalty: 0, trips: 0, hours: 0, volume: 0 };
    const accrual = Math.round(b.accrual * 100) / 100;
    const fuelHold = Math.round(b.fuelHold * 100) / 100;
    const penalty = Math.round(b.penalty * 100) / 100;
    const net = Math.round((accrual - fuelHold - penalty) * 100) / 100;
    return {
      id: c.id,
      number: c.number,
      contractor: contractorById.get(c.contractor_id)?.name ?? "—",
      contract_type: c.contract_type,
      accrual,
      fuelHold,
      penalty,
      net,
      forecast: Math.round((net / elapsed) * totalDays),
      tripsCount: b.trips,
      hoursSum: b.hours,
      costPerTrip: b.trips > 0 ? Math.round(net / b.trips) : null,
      costPerHour: b.hours > 0 ? Math.round(net / b.hours) : null,
      tengePerM3: b.volume > 0 ? Math.round(net / b.volume) : null,
    };
  });
  contracts.sort((a, b) => a.number.localeCompare(b.number, "ru"));
  return { contracts };
}
