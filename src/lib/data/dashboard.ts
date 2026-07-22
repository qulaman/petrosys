import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { resolvePeriod, type ResolvedPeriod } from "@/lib/journals/period";
import { loadClosedJournalIds, loadOpenLineupIds, resolveFuelPrice, resolveRate, tripCounted, type RatePriceRow } from "@/lib/data/money";
import { aqtobeDate } from "@/lib/tz";

export type EventKind = "fuel" | "trip" | "shift";

export interface FeedEvent {
  id: string;
  kind: EventKind;
  at: string;
  vehicle_id: string;
  driver_id: string;
  detail: string; // «200 л · карта» / «рейс» / «10 ч»
  /** Числа для агрегатов групп ленты. */
  liters?: number;
  source?: "card" | "tanker";
  hours?: number;
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

/** План/факт выхода самосвалов на линию (по выводам учётчика за сегодня). */
export interface LineupToday {
  planned: number;
  worked: number;
  notOutRegs: string[];
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
  /** Начислено сегодня по договорным ставкам (оценка: включая черновики журналов). */
  accruedToday: number;
  /** Вчерашние значения для Δ — до того же часа, что и сейчас (сравнение сопоставимо). */
  prev: { trips: number; hours: number; liters: number; accrued: number };
  lineup: LineupToday;
  attention: AttentionItem[];
  /** Последняя гео-точка каждой машины с записями за сегодня. */
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
  const [veh, drv, fuelRows, tripRows, shiftRows, prevFuel, prevTripRows, prevShifts, attentionRes, balRes, tankersRes, prices, lineupsRes] =
    await Promise.all([
      supabase.from("vehicles").select("id, reg_number, is_active, vehicle_type, contract_id"),
      supabase.from("drivers").select("id, full_name"),
      fetchAll((f, t) => supabase.from("fuel_issues").select("id, created_at, liters, source_type, vehicle_id, driver_id, geo_lat, geo_lng").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("trip_records").select("id, created_at, vehicle_id, driver_id, geo_lat, geo_lng").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("shift_records").select("id, created_at, vehicle_id, driver_id, hours").eq("shift_date", period.fromDate).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("fuel_issues").select("liters").gte("created_at", prevFromISO).lt("created_at", prevCutISO).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("trip_records").select("vehicle_id, created_at").gte("created_at", prevFromISO).lt("created_at", prevCutISO).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("shift_records").select("vehicle_id, hours").eq("shift_date", prevFromDate).lt("created_at", prevCutISO).order("id").range(f, t)),
      supabase.from("anomalies").select("id, type, detected_at, entity_refs").eq("status", "new").order("detected_at", { ascending: false }).limit(5),
      admin.from("tanker_balances").select("tanker_id, calculated_liters, last_measured_at").eq("org_id", orgId),
      admin.from("tankers").select("id, name").eq("org_id", orgId).eq("is_active", true),
      fetchAll((f, t) => supabase.from("price_list").select("contract_id, unit, vehicle_type, vehicle_id, price, valid_from").order("id").range(f, t)),
      supabase.from("trip_lineups").select("id").eq("work_date", period.fromDate),
    ]);

  const vehicleNames: Record<string, string> = {};
  for (const v of veh.data ?? []) vehicleNames[v.id] = v.reg_number;
  const driverNames: Record<string, string> = {};
  for (const d of drv.data ?? []) driverNames[d.id] = d.full_name;
  const vehInfo = new Map((veh.data ?? []).map((v) => [v.id, v]));

  // «Начислено сегодня» — оперативная оценка по договорным ставкам
  // (включая черновики журналов — как и плитка часов; деньги в расчётах строже).
  const pricesByContract = new Map<string, RatePriceRow[]>();
  for (const p of prices) {
    if (!p.contract_id) continue;
    (pricesByContract.get(p.contract_id) ?? pricesByContract.set(p.contract_id, []).get(p.contract_id))!
      .push({ unit: p.unit, vehicle_type: p.vehicle_type, vehicle_id: p.vehicle_id, price: Number(p.price), valid_from: p.valid_from });
  }
  const tripAccrual = (rows: { vehicle_id: string; created_at: string }[]) => {
    let sum = 0;
    for (const r of rows) {
      const v = vehInfo.get(r.vehicle_id);
      if (!v?.contract_id) continue;
      sum += resolveRate(pricesByContract.get(v.contract_id) ?? [], "trip", v.id, v.vehicle_type, aqtobeDate(r.created_at)) ?? 0;
    }
    return sum;
  };
  const shiftAccrual = (rows: { vehicle_id: string; hours: number }[], date: string) => {
    let sum = 0;
    for (const r of rows) {
      const v = vehInfo.get(r.vehicle_id);
      if (!v?.contract_id) continue;
      const rate = resolveRate(pricesByContract.get(v.contract_id) ?? [], "hour", v.id, v.vehicle_type, date);
      if (rate != null) sum += rate * Number(r.hours);
    }
    return sum;
  };
  const accruedToday = Math.round(tripAccrual(tripRows) + shiftAccrual(shiftRows, period.fromDate));
  const prevAccrued = Math.round(tripAccrual(prevTripRows) + shiftAccrual(prevShifts, prevFromDate));

  // План/факт выхода на линию: выводы учётчика за сегодня против машин с рейсами.
  const lineupIds = (lineupsRes.data ?? []).map((l) => l.id);
  let lineup: LineupToday = { planned: 0, worked: 0, notOutRegs: [] };
  if (lineupIds.length) {
    const { data: lv } = await supabase.from("trip_lineup_vehicles").select("vehicle_id").in("lineup_id", lineupIds);
    const plannedIds = new Set((lv ?? []).map((x) => x.vehicle_id));
    const workedIds = new Set(tripRows.map((t) => t.vehicle_id));
    const notOutRegs = [...plannedIds]
      .filter((id) => !workedIds.has(id))
      .map((id) => vehicleNames[id] ?? "—")
      .sort((a, b) => a.localeCompare(b, "ru"));
    lineup = { planned: plannedIds.size, worked: plannedIds.size - notOutRegs.length, notOutRegs };
  }

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

  // Вся лента дня (сотни строк — некритично): клиент группирует серии и часы.
  const events: FeedEvent[] = [
    ...fuelRows.map((r) => ({
      id: r.id, kind: "fuel" as const, at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id,
      detail: `${Number(r.liters)} л · ${r.source_type === "card" ? "карта" : "бензовоз"}`,
      liters: Number(r.liters),
      source: (r.source_type === "card" ? "card" : "tanker") as "card" | "tanker",
    })),
    ...tripRows.map((r) => ({
      id: r.id, kind: "trip" as const, at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id, detail: "рейс",
    })),
    ...shiftRows.map((r) => ({
      id: r.id, kind: "shift" as const, at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id,
      detail: `${Number(r.hours)} ч`, hours: Number(r.hours),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

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
    trips: prevTripRows.length,
    hours: prevShifts.reduce((s, r) => s + Number(r.hours), 0),
    liters: prevFuel.reduce((s, r) => s + Number(r.liters), 0),
    accrued: prevAccrued,
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

  // Последняя гео-точка каждой машины за сегодня (учёт идёт по всему объекту).
  const lastByVehicle = new Map<string, GeoPoint>();
  const considerGeo = (vehicleId: string, kind: "fuel" | "trip", at: string, lat: unknown, lng: unknown) => {
    if (lat == null || lng == null) return;
    const cur = lastByVehicle.get(vehicleId);
    if (!cur || cur.at < at) {
      lastByVehicle.set(vehicleId, { kind, reg: vehicleNames[vehicleId] ?? "—", at, lat: Number(lat), lng: Number(lng) });
    }
  };
  for (const r of fuelRows) considerGeo(r.vehicle_id, "fuel", r.created_at, r.geo_lat, r.geo_lng);
  for (const r of tripRows) considerGeo(r.vehicle_id, "trip", r.created_at, r.geo_lat, r.geo_lng);
  const geoPoints: GeoPoint[] = [...lastByVehicle.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 20);

  return {
    orgId,
    date: period.fromDate,
    onlineVehicleIds: [...online],
    techTotal: (veh.data ?? []).filter((v) => v.is_active).length,
    tripsToday: tripRows.length,
    hoursToday,
    litersCard,
    litersTanker,
    accruedToday,
    prev,
    lineup,
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
  date: string; // yyyy-mm-dd — переход в журнал за день по клику
  label: string; // dd.mm
  card: number;
  tanker: number;
}
export interface NormRow {
  vehicle_id: string;
  reg: string;
  actual: number; // л/моточас факт
  norm: number; // только машины с заполненным нормативом
  overPct: number; // +24 = на 24 % выше нормы; отрицательное — ниже
}
export interface TopConsumer {
  vehicle_id: string;
  reg: string;
  liters: number;
  perHour: number | null; // л/моточас (null — нет часов за период)
  attention: boolean; // открытая аномалия over_norm / fuel_no_work
}
export interface FuelSummary {
  totalLiters: number;
  litersCard: number;
  litersTanker: number;
  vehiclesFueled: number;
  /** Удержания за ГСМ по договорным ценам, ₸ (0 — цены не заданы/выдач нет). */
  fuelHoldTenge: number;
  overCount: number;
  /** Есть ли вообще нормативы у техники на моточасах (иначе блок норм мёртв). */
  normFilled: boolean;
}
export interface FuelTabData {
  daily: DailyIssue[];
  summary: FuelSummary;
  norm: NormRow[];
  /** Работавшая техника на моточасах без норматива — кандидаты на заполнение. */
  noNormRegs: string[];
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
  const [veh, fuelRows, shiftRows, fuelPricesRes, attentionRes] = await Promise.all([
    supabase.from("vehicles").select("id, reg_number, fuel_norm_per_hour, accounting_type, contract_id"),
    fetchAll((f, t) => supabase.from("fuel_issues").select("created_at, liters, source_type, vehicle_id").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
    fetchAll((f, t) => supabase.from("shift_records").select("vehicle_id, hours").gte("shift_date", period.fromDate).lte("shift_date", period.toDate).order("id").range(f, t)),
    supabase.from("contract_fuel_prices").select("contract_id, price_per_liter, valid_from"),
    supabase.from("anomalies").select("type, entity_refs").in("status", ["new", "reviewed"]).in("type", ["over_norm", "fuel_no_work"]),
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
    return { date: d, label: ddmm(d), card: c.card, tanker: c.tanker };
  });

  // 2) расход к нормативу (техника на моточасах с заполненным нормативом)
  const litersByVeh = new Map<string, number>();
  for (const r of fuelRows) litersByVeh.set(r.vehicle_id, (litersByVeh.get(r.vehicle_id) ?? 0) + Number(r.liters));
  const hoursByVeh = new Map<string, number>();
  for (const r of shiftRows) hoursByVeh.set(r.vehicle_id, (hoursByVeh.get(r.vehicle_id) ?? 0) + Number(r.hours));

  const norm: NormRow[] = [];
  const noNormRegs: string[] = [];
  let normFilled = false;
  for (const v of veh.data ?? []) {
    if (v.accounting_type !== "hours") continue;
    const normVal = v.fuel_norm_per_hour == null ? null : Number(v.fuel_norm_per_hour);
    if (normVal != null) normFilled = true;
    const hours = hoursByVeh.get(v.id) ?? 0;
    const liters = litersByVeh.get(v.id) ?? 0;
    if (hours <= 0 && liters <= 0) continue; // не работала за период
    if (normVal == null) {
      noNormRegs.push(v.reg_number);
      continue;
    }
    if (hours <= 0) continue; // литры без часов — территория детектора fuel_no_work
    const actual = Math.round((liters / hours) * 10) / 10;
    norm.push({
      vehicle_id: v.id,
      reg: v.reg_number,
      actual,
      norm: normVal,
      overPct: Math.round((actual / normVal - 1) * 100),
    });
  }
  norm.sort((a, b) => b.overPct - a.overPct);
  noNormRegs.sort((a, b) => a.localeCompare(b, "ru"));

  // 3) топ потребителей + флаг «есть открытая аномалия по машине»
  const attentionVeh = new Set<string>();
  for (const a of attentionRes.data ?? []) {
    const refs = (a.entity_refs ?? {}) as { vehicle_id?: string };
    if (refs.vehicle_id) attentionVeh.add(refs.vehicle_id);
  }
  const top: TopConsumer[] = [...litersByVeh.entries()]
    .map(([id, liters]) => {
      const hours = hoursByVeh.get(id) ?? 0;
      return {
        vehicle_id: id,
        reg: vMap.get(id)?.reg_number ?? "—",
        liters,
        perHour: hours > 0 ? Math.round((liters / hours) * 10) / 10 : null,
        attention: attentionVeh.has(id),
      };
    })
    .sort((a, b) => b.liters - a.liters)
    .slice(0, 10);

  // 4) сводка: литры, машины, удержания по договорным ценам ГСМ
  const fuelPricesByContract = new Map<string, { price: number; valid_from: string }[]>();
  for (const f of fuelPricesRes.data ?? []) {
    if (!f.contract_id) continue;
    (fuelPricesByContract.get(f.contract_id) ?? fuelPricesByContract.set(f.contract_id, []).get(f.contract_id))!
      .push({ price: Number(f.price_per_liter), valid_from: f.valid_from });
  }
  let fuelHoldTenge = 0;
  let litersCard = 0;
  let litersTanker = 0;
  for (const r of fuelRows) {
    if (r.source_type === "card") litersCard += Number(r.liters);
    else litersTanker += Number(r.liters);
    const contractId = vMap.get(r.vehicle_id)?.contract_id;
    if (!contractId) continue;
    const price = resolveFuelPrice(fuelPricesByContract.get(contractId) ?? [], aqtobeDate(r.created_at));
    if (price != null) fuelHoldTenge += price * Number(r.liters);
  }

  return {
    daily,
    summary: {
      totalLiters: litersCard + litersTanker,
      litersCard,
      litersTanker,
      vehiclesFueled: litersByVeh.size,
      fuelHoldTenge: Math.round(fuelHoldTenge),
      overCount: norm.filter((n) => n.overPct > 0).length,
      normFilled,
    },
    norm,
    noNormRegs,
    top,
  };
}

// =============================== ВКЛАДКА «РАБОТА» ===============================
/** Колонка тепловой карты: день или неделя (при периоде > 60 дней). */
export interface HeatBucket { label: string; from: string; to: string }
export interface HeatRow { vehicle_id: string; reg: string; cells: number[]; total: number }
export interface IntervalBucket { label: string; count: number }
/** Гистограмма интервалов: reg=null — все самосвалы разом. */
export interface IntervalGroup { reg: string | null; buckets: IntervalBucket[]; median: number | null }
export interface ProductivityRow { reg: string; avgPerDay: number }
export interface WorkSummary {
  tripsTotal: number;
  hoursTotal: number;
  worked: number;
  fleet: number;
  idle: number;
  /** Перевезено м³ (объёмы из маршрутов); null — объёмы не заполнены. */
  m3Total: number | null;
}
export interface WorkTabData {
  buckets: HeatBucket[];
  weekly: boolean;
  periodFrom: string;
  periodTo: string;
  summary: WorkSummary;
  /** Техника на моточасах, работавшая за период (сортировка по итогу). */
  hoursRows: HeatRow[];
  hoursIdleRegs: string[];
  hoursDayTotals: number[];
  maxHoursCell: number;
  /** Самосвалы, работавшие за период (сортировка по итогу). */
  tripsRows: HeatRow[];
  tripsIdleRegs: string[];
  tripsDayTotals: number[];
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
  const [veh, trips, shifts, routesRes] = await Promise.all([
    supabase.from("vehicles").select("id, reg_number, accounting_type").eq("is_active", true).order("reg_number"),
    fetchAll((f, t) => supabase.from("trip_records").select("vehicle_id, created_at, route_id").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
    fetchAll((f, t) => supabase.from("shift_records").select("vehicle_id, hours, shift_date").gte("shift_date", period.fromDate).lte("shift_date", period.toDate).order("id").range(f, t)),
    supabase.from("routes").select("id, volume_m3"),
  ]);

  const allDays = eachDay(period.fromDate, period.toDate);
  // > 60 дней — по дням нечитаемо и тяжело: агрегируем колонки в недели.
  const weekly = allDays.length > 60;
  const dayGroups: { label: string; days: string[] }[] = weekly
    ? Array.from({ length: Math.ceil(allDays.length / 7) }, (_, i) => {
        const chunk = allDays.slice(i * 7, i * 7 + 7);
        return { label: `с ${ddmm(chunk[0])}`, days: chunk };
      })
    : allDays.map((d) => ({ label: ddmm(d), days: [d] }));
  const buckets: HeatBucket[] = dayGroups.map((g) => ({ label: g.label, from: g.days[0], to: g.days[g.days.length - 1] }));

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
  // Полностью пустые строки — в отдельный список простоя, работавшие — по итогу.
  let maxHoursCell = 0;
  let maxTripsCell = 0;
  const hoursRows: HeatRow[] = [];
  const tripsRows: HeatRow[] = [];
  const hoursIdleRegs: string[] = [];
  const tripsIdleRegs: string[] = [];
  for (const v of veh.data ?? []) {
    const isTrips = v.accounting_type === "trips";
    const src = isTrips ? tripCount : hoursSum;
    const cells = dayGroups.map((g) => {
      const val = g.days.reduce((s, d) => s + (src.get(`${v.id}|${d}`) ?? 0), 0);
      if (isTrips) { if (val > maxTripsCell) maxTripsCell = val; }
      else if (val > maxHoursCell) maxHoursCell = val;
      return Math.round(val * 10) / 10;
    });
    const total = Math.round(cells.reduce((s, n) => s + n, 0) * 10) / 10;
    if (total <= 0) {
      (isTrips ? tripsIdleRegs : hoursIdleRegs).push(v.reg_number);
      continue;
    }
    (isTrips ? tripsRows : hoursRows).push({ vehicle_id: v.id, reg: v.reg_number, cells, total });
  }
  hoursRows.sort((a, b) => b.total - a.total);
  tripsRows.sort((a, b) => b.total - a.total);
  const dayTotals = (rows: HeatRow[]) =>
    buckets.map((_, i) => Math.round(rows.reduce((s, r) => s + r.cells[i], 0) * 10) / 10);

  // Сводка: рейсы, часы, занятость парка, кубометры (мертво до заполнения маршрутов).
  const routeVolume = new Map((routesRes.data ?? []).map((r) => [r.id, r.volume_m3 == null ? null : Number(r.volume_m3)]));
  const routesFilled = [...routeVolume.values()].some((v) => v != null);
  const m3Total = routesFilled
    ? Math.round(trips.reduce((s, t) => s + (routeVolume.get(t.route_id) ?? 0), 0))
    : null;
  const fleet = (veh.data ?? []).length;
  const worked = hoursRows.length + tripsRows.length;
  const summary: WorkSummary = {
    tripsTotal: trips.length,
    hoursTotal: Math.round(shifts.reduce((s, r) => s + Number(r.hours), 0) * 10) / 10,
    worked,
    fleet,
    idle: fleet - worked,
    m3Total,
  };

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
    buckets,
    weekly,
    periodFrom: period.fromDate,
    periodTo: period.toDate,
    summary,
    hoursRows,
    hoursIdleRegs,
    hoursDayTotals: dayTotals(hoursRows),
    maxHoursCell: Math.max(1, maxHoursCell),
    tripsRows,
    tripsIdleRegs,
    tripsDayTotals: dayTotals(tripsRows),
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
export interface MoneySummary {
  accrual: number;
  fuelHold: number;
  penalty: number;
  net: number;
  forecast: number;
  elapsedDays: number;
  totalDays: number;
}
/** Накопление начислений нарастающим итогом по дням + линия прогноза. */
export interface MoneyDailyPoint {
  label: string; // dd.mm
  accrued: number | null; // факт нарастающим итогом (null для будущих дней)
  forecast: number; // линейный прогноз нарастающим итогом
}
/** Работа вне расчётов: причина, по которой рейсы/часы не превратились в деньги. */
export interface UnbilledRow {
  reg: string;
  reason: "no_contract" | "no_rate";
  contractor: string | null;
  contractId: string | null;
  contractNumber: string | null;
  trips: number;
  hours: number;
}
export interface UnbilledSummary {
  trips: number;
  hours: number;
  vehicles: number;
}
export interface MoneyTabData {
  contracts: ContractMoney[];
  summary: MoneySummary;
  daily: MoneyDailyPoint[];
  unbilled: UnbilledRow[];
  unbilledSummary: UnbilledSummary;
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
      supabase.from("vehicles").select("id, reg_number, vehicle_type, contract_id"),
      fetchAll((f, t) => supabase.from("price_list").select("contract_id, unit, vehicle_type, vehicle_id, price, valid_from").order("id").range(f, t)),
      supabase.from("contract_fuel_prices").select("contract_id, price_per_liter, valid_from"),
      fetchAll((f, t) => supabase.from("trip_records").select("vehicle_id, created_at, route_id, lineup_id").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("shift_records").select("vehicle_id, hours, shift_date, journal_id").gte("shift_date", period.fromDate).lte("shift_date", period.toDate).order("id").range(f, t)),
      fetchAll((f, t) => supabase.from("fuel_issues").select("vehicle_id, liters, created_at").gte("created_at", period.fromISO).lt("created_at", period.toISO).order("id").range(f, t)),
      supabase.from("penalties").select("contract_id, amount").is("settled_in_period", null),
      supabase.from("routes").select("id, volume_m3"),
    ]);
  const routeVolume = new Map((routesRes.data ?? []).map((r) => [r.id, r.volume_m3 == null ? null : Number(r.volume_m3)]));

  // Волна 2 — статусы журналов смен (оплачиваются только закрытые) и открытых
  // карточек рейсов (их рейсы — черновик, в деньги не идут).
  const journalIds = [...new Set(shiftsRows.map((s) => s.journal_id).filter((x): x is string => !!x))];
  const [closedJournals, openLineups] = await Promise.all([
    loadClosedJournalIds(supabase, journalIds),
    loadOpenLineupIds(supabase),
  ]);
  const countedTrips = trips.filter((t) => tripCounted(t, openLineups));

  const contractorById = new Map((contractorsRes.data ?? []).map((c) => [c.id, c]));
  const contractById = new Map((contractsRes.data ?? []).map((c) => [c.id, c]));
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
  // Начисления за рейсы и за часы копятся РАЗДЕЛЬНО: эффективная стоимость
  // (₸/рейс, ₸/час) считается каждая от своей части, иначе у смешанных
  // договоров часовые начисления попадают в «стоимость рейса» и наоборот.
  const acc = new Map<string, { accrualTrips: number; accrualHours: number; fuelHold: number; penalty: number; trips: number; hours: number; volume: number }>();
  const bucket = (cid: string) => {
    let b = acc.get(cid);
    if (!b) { b = { accrualTrips: 0, accrualHours: 0, fuelHold: 0, penalty: 0, trips: 0, hours: 0, volume: 0 }; acc.set(cid, b); }
    return b;
  };

  // Работа вне расчётов: нет договора или нет ставки в прайсе → в деньги не попала.
  const unbilledMap = new Map<string, UnbilledRow>();
  const unbilled = (v: { id: string; reg_number: string; contract_id: string | null }, reason: "no_contract" | "no_rate") => {
    let u = unbilledMap.get(v.id);
    if (!u) {
      const contract = v.contract_id ? contractById.get(v.contract_id) : null;
      u = {
        reg: v.reg_number,
        reason,
        contractId: v.contract_id,
        contractNumber: contract?.number ?? null,
        contractor: contract ? contractorById.get(contract.contractor_id)?.name ?? null : null,
        trips: 0,
        hours: 0,
      };
      unbilledMap.set(v.id, u);
    }
    return u;
  };
  // Накопление начислений по дню события (для графика нарастающим итогом).
  const accrualByDay = new Map<string, number>();
  const addDayAccrual = (day: string, amount: number) => accrualByDay.set(day, (accrualByDay.get(day) ?? 0) + amount);

  for (const t of countedTrips) {
    const v = vehById.get(t.vehicle_id);
    if (!v) continue;
    if (!v.contract_id) { unbilled(v, "no_contract").trips += 1; continue; }
    const b = bucket(v.contract_id);
    b.trips += 1;
    b.volume += routeVolume.get(t.route_id) ?? 0;
    const rate = resolveRate(pricesByContract.get(v.contract_id) ?? [], "trip", v.id, v.vehicle_type, aqtobeDate(t.created_at));
    if (rate != null) { b.accrualTrips += rate; addDayAccrual(aqtobeDate(t.created_at), rate); }
    else unbilled(v, "no_rate").trips += 1;
  }
  for (const s of shiftsRows) {
    if (s.journal_id && !closedJournals.has(s.journal_id)) continue; // черновики не оплачиваются
    const v = vehById.get(s.vehicle_id);
    if (!v) continue;
    const hours = Number(s.hours);
    if (!v.contract_id) { unbilled(v, "no_contract").hours += hours; continue; }
    const b = bucket(v.contract_id);
    b.hours += hours;
    const rate = resolveRate(pricesByContract.get(v.contract_id) ?? [], "hour", v.id, v.vehicle_type, s.shift_date);
    if (rate != null) { b.accrualHours += rate * hours; addDayAccrual(s.shift_date, rate * hours); }
    else unbilled(v, "no_rate").hours += hours;
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
    const b = acc.get(c.id) ?? { accrualTrips: 0, accrualHours: 0, fuelHold: 0, penalty: 0, trips: 0, hours: 0, volume: 0 };
    const accrual = Math.round((b.accrualTrips + b.accrualHours) * 100) / 100;
    const fuelHold = Math.round(b.fuelHold * 100) / 100;
    const penalty = Math.round(b.penalty * 100) / 100;
    const net = Math.round((accrual - fuelHold - penalty) * 100) / 100;
    // Общедоговорные удержания (ГСМ, штрафы) распределяются между рейсовой и
    // часовой частью пропорционально начислению — каждая метрика делит СВОЮ часть.
    const accrualSum = b.accrualTrips + b.accrualHours;
    const holds = fuelHold + penalty;
    const netTrips = accrualSum > 0 ? b.accrualTrips - holds * (b.accrualTrips / accrualSum) : 0;
    const netHours = accrualSum > 0 ? b.accrualHours - holds * (b.accrualHours / accrualSum) : 0;
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
      costPerTrip: b.trips > 0 && b.accrualTrips > 0 ? Math.round(netTrips / b.trips) : null,
      costPerHour: b.hours > 0 && b.accrualHours > 0 ? Math.round(netHours / b.hours) : null,
      tengePerM3: b.volume > 0 && b.accrualTrips > 0 ? Math.round(netTrips / b.volume) : null,
    };
  });
  contracts.sort((a, b) => a.number.localeCompare(b.number, "ru"));

  // Сводка периода.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const sumAccrual = round2(contracts.reduce((s, c) => s + c.accrual, 0));
  const sumFuelHold = round2(contracts.reduce((s, c) => s + c.fuelHold, 0));
  const sumPenalty = round2(contracts.reduce((s, c) => s + c.penalty, 0));
  const sumNet = round2(sumAccrual - sumFuelHold - sumPenalty);
  const summary: MoneySummary = {
    accrual: sumAccrual,
    fuelHold: sumFuelHold,
    penalty: sumPenalty,
    net: sumNet,
    forecast: Math.round((sumNet / elapsed) * totalDays),
    elapsedDays: Math.min(elapsed, totalDays),
    totalDays,
  };

  // Накопление начислений по дням + линия прогноза (нарастающим итогом).
  const dailyRate = sumAccrual / elapsed; // средние начисления в день по факту
  let running = 0;
  const daily: MoneyDailyPoint[] = eachDay(period.fromDate, period.toDate).map((d, i) => {
    const dayNo = i + 1;
    const isPast = dayNo <= elapsed;
    if (isPast) running += accrualByDay.get(d) ?? 0;
    return {
      label: `${d.slice(8, 10)}.${d.slice(5, 7)}`,
      accrued: isPast ? Math.round(running) : null,
      forecast: Math.round(dailyRate * dayNo),
    };
  });

  // Вне расчётов: сортировка «нет договора» → «нет ставки», внутри по объёму.
  const unbilledRows = [...unbilledMap.values()].sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === "no_contract" ? -1 : 1;
    return (b.trips + b.hours) - (a.trips + a.hours);
  });
  const unbilledSummary: UnbilledSummary = {
    trips: unbilledRows.reduce((s, u) => s + u.trips, 0),
    hours: Math.round(unbilledRows.reduce((s, u) => s + u.hours, 0) * 10) / 10,
    vehicles: unbilledRows.length,
  };

  return { contracts, summary, daily, unbilled: unbilledRows, unbilledSummary };
}
