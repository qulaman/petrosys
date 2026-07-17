import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { resolvePeriod, type ResolvedPeriod } from "@/lib/journals/period";
import { resolveRate, type RatePriceRow } from "@/lib/data/settlement";
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
  techOnline: number;
  techTotal: number;
  tripsToday: number;
  hoursToday: number;
  litersCard: number;
  litersTanker: number;
  /** Вчерашние значения для Δ. */
  prev: { trips: number; hours: number; liters: number };
  attention: AttentionItem[];
  geoPoints: GeoPoint[];
  recentEvents: FeedEvent[];
  tankerBalances: TankerBalanceRow[];
  newAnomalies: number;
  vehicleNames: Record<string, string>;
  driverNames: Record<string, string>;
}

export async function loadTodayData(): Promise<TodayData> {
  const current = await getCurrentProfile();
  const orgId = current?.profile?.org_id ?? "";
  const period = resolvePeriod({ period: "today" });

  // Вчера — для Δ на плитках.
  const prevDate = new Date(`${period.fromDate}T00:00:00Z`);
  prevDate.setUTCDate(prevDate.getUTCDate() - 1);
  const prevFromDate = prevDate.toISOString().slice(0, 10);
  const prevFromISO = `${prevFromDate}T00:00:00+05:00`;

  const supabase = await createClient();
  const [veh, drv, fuel, trips, shifts, anomalies, prevFuel, prevTrips, prevShifts, attentionRes] = await Promise.all([
    supabase.from("vehicles").select("id, reg_number, is_active"),
    supabase.from("drivers").select("id, full_name"),
    supabase.from("fuel_issues").select("id, created_at, liters, source_type, vehicle_id, driver_id, geo_lat, geo_lng").gte("created_at", period.fromISO).lt("created_at", period.toISO),
    supabase.from("trip_records").select("id, created_at, vehicle_id, driver_id, geo_lat, geo_lng").gte("created_at", period.fromISO).lt("created_at", period.toISO),
    supabase.from("shift_records").select("id, created_at, vehicle_id, driver_id, hours").eq("shift_date", period.fromDate),
    supabase.from("anomalies").select("id", { count: "exact", head: true }).eq("status", "new"),
    supabase.from("fuel_issues").select("liters").gte("created_at", prevFromISO).lt("created_at", period.fromISO),
    supabase.from("trip_records").select("id", { count: "exact", head: true }).gte("created_at", prevFromISO).lt("created_at", period.fromISO),
    supabase.from("shift_records").select("hours").eq("shift_date", prevFromDate),
    supabase.from("anomalies").select("id, type, detected_at, entity_refs").eq("status", "new").order("detected_at", { ascending: false }).limit(5),
  ]);

  const vehicleNames: Record<string, string> = {};
  for (const v of veh.data ?? []) vehicleNames[v.id] = v.reg_number;
  const driverNames: Record<string, string> = {};
  for (const d of drv.data ?? []) driverNames[d.id] = d.full_name;

  const fuelRows = fuel.data ?? [];
  const tripRows = trips.data ?? [];
  const shiftRows = shifts.data ?? [];

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

  // балансы бензовозов — через admin (RLS занижает агрегаты)
  const admin = createAdminClient();
  const [balRes, tankersRes] = await Promise.all([
    admin.from("tanker_balances").select("tanker_id, calculated_liters, last_measured_at").eq("org_id", orgId),
    admin.from("tankers").select("id, name").eq("org_id", orgId).eq("is_active", true),
  ]);
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

  // Δ ко вчера
  const prev = {
    trips: prevTrips.count ?? 0,
    hours: (prevShifts.data ?? []).reduce((s, r) => s + Number(r.hours), 0),
    liters: (prevFuel.data ?? []).reduce((s, r) => s + Number(r.liters), 0),
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
    techOnline: online.size,
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
    newAnomalies: anomalies.count ?? 0,
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

export async function loadFuelTabData(period: ResolvedPeriod): Promise<FuelTabData> {
  const supabase = await createClient();
  const [veh, fuel, shifts] = await Promise.all([
    supabase.from("vehicles").select("id, reg_number, fuel_norm_per_hour, accounting_type"),
    supabase.from("fuel_issues").select("created_at, liters, source_type, vehicle_id").gte("created_at", period.fromISO).lt("created_at", period.toISO),
    supabase.from("shift_records").select("vehicle_id, hours").gte("shift_date", period.fromDate).lte("shift_date", period.toDate),
  ]);

  const vMap = new Map((veh.data ?? []).map((v) => [v.id, v]));
  const fuelRows = fuel.data ?? [];

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
    return { label: `${d.slice(8, 10)}.${d.slice(5, 7)}`, card: c.card, tanker: c.tanker };
  });

  // 2) расход к нормативу (техника на моточасах)
  const litersByVeh = new Map<string, number>();
  for (const r of fuelRows) litersByVeh.set(r.vehicle_id, (litersByVeh.get(r.vehicle_id) ?? 0) + Number(r.liters));
  const hoursByVeh = new Map<string, number>();
  for (const r of shifts.data ?? []) hoursByVeh.set(r.vehicle_id, (hoursByVeh.get(r.vehicle_id) ?? 0) + Number(r.hours));

  const norm: NormRow[] = [];
  for (const v of veh.data ?? []) {
    if (v.accounting_type !== "hours") continue;
    const hours = hoursByVeh.get(v.id) ?? 0;
    const liters = litersByVeh.get(v.id) ?? 0;
    if (hours <= 0 && liters <= 0) continue;
    const actual = hours > 0 ? Math.round((liters / hours) * 10) / 10 : 0;
    const normVal = v.fuel_norm_per_hour == null ? null : Number(v.fuel_norm_per_hour);
    norm.push({ reg: v.reg_number, actual, norm: normVal, over: normVal != null && actual > normVal });
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
export interface HeatCell { value: number }
export interface HeatRow { reg: string; type: "hours" | "trips"; cells: number[] }
export interface IntervalBucket { label: string; count: number }
export interface ProductivityRow { reg: string; avgPerDay: number }
export interface WorkTabData {
  days: string[]; // dd.mm
  rows: HeatRow[];
  maxCell: number;
  /** Гистограмма интервалов между рейсами (все самосвалы), минуты. */
  intervalBuckets: IntervalBucket[];
  intervalMedian: number | null;
  /** Выработка самосвалов: рейсов в день против медианы парка. */
  productivity: ProductivityRow[];
  productivityMedian: number | null;
}

export async function loadWorkTabData(period: ResolvedPeriod): Promise<WorkTabData> {
  const supabase = await createClient();
  const [veh, trips, shifts] = await Promise.all([
    supabase.from("vehicles").select("id, reg_number, accounting_type").eq("is_active", true).order("reg_number"),
    supabase.from("trip_records").select("vehicle_id, created_at").gte("created_at", period.fromISO).lt("created_at", period.toISO),
    supabase.from("shift_records").select("vehicle_id, hours, shift_date").gte("shift_date", period.fromDate).lte("shift_date", period.toDate),
  ]);

  const days = eachDay(period.fromDate, period.toDate);
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  // agg maps: `${vehicle}|${day}` -> value
  const tripCount = new Map<string, number>();
  for (const t of trips.data ?? []) {
    const k = `${t.vehicle_id}|${aqtobeDate(t.created_at)}`;
    tripCount.set(k, (tripCount.get(k) ?? 0) + 1);
  }
  const hoursSum = new Map<string, number>();
  for (const s of shifts.data ?? []) {
    const k = `${s.vehicle_id}|${s.shift_date}`;
    hoursSum.set(k, (hoursSum.get(k) ?? 0) + Number(s.hours));
  }

  let maxCell = 0;
  const rows: HeatRow[] = (veh.data ?? []).map((v) => {
    const cells = days.map((d) => {
      const val = v.accounting_type === "trips"
        ? tripCount.get(`${v.id}|${d}`) ?? 0
        : hoursSum.get(`${v.id}|${d}`) ?? 0;
      if (val > maxCell) maxCell = val;
      return val;
    });
    return { reg: v.reg_number, type: v.accounting_type as "hours" | "trips", cells };
  });

  // Интервалы между рейсами: сортируем ходки каждой машины по дню, разницы в минутах.
  const tripsByVehDay = new Map<string, number[]>();
  for (const t of trips.data ?? []) {
    const k = `${t.vehicle_id}|${aqtobeDate(t.created_at)}`;
    (tripsByVehDay.get(k) ?? tripsByVehDay.set(k, []).get(k))!.push(new Date(t.created_at).getTime());
  }
  const intervals: number[] = [];
  for (const times of tripsByVehDay.values()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) intervals.push(Math.round((times[i] - times[i - 1]) / 60000));
  }
  const BUCKETS: [string, (m: number) => boolean][] = [
    ["<15", (m) => m < 15], ["15–30", (m) => m >= 15 && m < 30], ["30–45", (m) => m >= 30 && m < 45],
    ["45–60", (m) => m >= 45 && m < 60], ["60–90", (m) => m >= 60 && m < 90], ["90–120", (m) => m >= 90 && m < 120],
    [">120", (m) => m >= 120],
  ];
  const intervalBuckets: IntervalBucket[] = BUCKETS.map(([label, fn]) => ({
    label, count: intervals.filter(fn).length,
  }));
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const intervalMedian = sortedIntervals.length ? sortedIntervals[Math.floor(sortedIntervals.length / 2)] : null;

  // Выработка самосвалов: среднее рейсов за активный день; медиана по парку.
  const productivity: ProductivityRow[] = (veh.data ?? [])
    .filter((v) => v.accounting_type === "trips")
    .map((v) => {
      const perDay = days.map((d) => tripCount.get(`${v.id}|${d}`) ?? 0).filter((n) => n > 0);
      const avg = perDay.length ? Math.round((perDay.reduce((s, n) => s + n, 0) / perDay.length) * 10) / 10 : 0;
      return { reg: v.reg_number, avgPerDay: avg };
    })
    .filter((p) => p.avgPerDay > 0)
    .sort((a, b) => b.avgPerDay - a.avgPerDay);
  const sortedProd = productivity.map((p) => p.avgPerDay).sort((a, b) => a - b);
  const productivityMedian = sortedProd.length ? sortedProd[Math.floor(sortedProd.length / 2)] : null;

  return {
    days: days.map((d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`),
    rows,
    maxCell: Math.max(1, maxCell),
    intervalBuckets,
    intervalMedian,
    productivity,
    productivityMedian,
  };
}

// =========================== ВКЛАДКА «ПОДРЯДЧИКИ И ДЕНЬГИ» ===========================
export interface ContractMoney {
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
 * Логика идентична loadSettlement: effective-dated ставки, ГСМ по дате выдачи,
 * только закрытые журналы смен, непогашенные штрафы.
 */
export async function loadMoneyTabData(period: ResolvedPeriod): Promise<MoneyTabData> {
  const supabase = await createClient();
  const today = resolvePeriod({ period: "today" }).fromDate;
  const totalDays = daysBetween(period.fromDate, period.toDate) + 1;
  const clampedEnd = today < period.toDate ? (today < period.fromDate ? period.fromDate : today) : period.toDate;
  const elapsed = Math.max(1, daysBetween(period.fromDate, clampedEnd) + 1);

  // Волна 1 — всё независимое, по всей организации разом.
  const [contractsRes, contractorsRes, vehiclesRes, pricesRes, fuelPricesRes, tripsRes, shiftsRes, fuelRes, penaltiesRes] =
    await Promise.all([
      supabase.from("contracts").select("id, number, contract_type, contractor_id"),
      supabase.from("contractors").select("id, name, vat_payer"),
      supabase.from("vehicles").select("id, vehicle_type, contract_id"),
      supabase.from("price_list").select("contract_id, unit, vehicle_type, vehicle_id, price, valid_from"),
      supabase.from("contract_fuel_prices").select("contract_id, price_per_liter, valid_from"),
      supabase.from("trip_records").select("vehicle_id, created_at, route_id").gte("created_at", period.fromISO).lt("created_at", period.toISO),
      supabase.from("shift_records").select("vehicle_id, hours, shift_date, journal_id").gte("shift_date", period.fromDate).lte("shift_date", period.toDate),
      supabase.from("fuel_issues").select("vehicle_id, liters, created_at").gte("created_at", period.fromISO).lt("created_at", period.toISO),
      supabase.from("penalties").select("contract_id, amount").is("settled_in_period", null),
    ]);
  const { data: routesData } = await supabase.from("routes").select("id, volume_m3");
  const routeVolume = new Map((routesData ?? []).map((r) => [r.id, r.volume_m3 == null ? null : Number(r.volume_m3)]));

  // Волна 2 — статусы журналов смен (оплачиваются только закрытые).
  const journalIds = [...new Set((shiftsRes.data ?? []).map((s) => s.journal_id).filter((x): x is string => !!x))];
  let closedJournals = new Set<string>();
  if (journalIds.length) {
    const { data: js } = await supabase.from("shift_journals").select("id, status").in("id", journalIds);
    closedJournals = new Set((js ?? []).filter((j) => j.status === "closed").map((j) => j.id));
  }

  const contractorById = new Map((contractorsRes.data ?? []).map((c) => [c.id, c]));
  const vehById = new Map((vehiclesRes.data ?? []).map((v) => [v.id, v]));
  const pricesByContract = new Map<string, RatePriceRow[]>();
  for (const p of pricesRes.data ?? []) {
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

  for (const t of tripsRes.data ?? []) {
    const v = vehById.get(t.vehicle_id);
    if (!v?.contract_id) continue;
    const b = bucket(v.contract_id);
    b.trips += 1;
    b.volume += routeVolume.get(t.route_id) ?? 0;
    const rate = resolveRate(pricesByContract.get(v.contract_id) ?? [], "trip", v.id, v.vehicle_type, aqtobeDate(t.created_at));
    if (rate != null) b.accrual += rate;
  }
  for (const s of shiftsRes.data ?? []) {
    if (s.journal_id && !closedJournals.has(s.journal_id)) continue; // черновики не оплачиваются
    const v = vehById.get(s.vehicle_id);
    if (!v?.contract_id) continue;
    const b = bucket(v.contract_id);
    b.hours += Number(s.hours);
    const rate = resolveRate(pricesByContract.get(v.contract_id) ?? [], "hour", v.id, v.vehicle_type, s.shift_date);
    if (rate != null) b.accrual += rate * Number(s.hours);
  }
  for (const f of fuelRes.data ?? []) {
    const v = vehById.get(f.vehicle_id);
    if (!v?.contract_id) continue;
    const date = aqtobeDate(f.created_at);
    const prices = (fuelPricesByContract.get(v.contract_id) ?? [])
      .filter((p) => p.valid_from <= date)
      .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));
    if (prices.length) bucket(v.contract_id).fuelHold += prices[0].price * Number(f.liters);
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
