import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { aqtobeDate, aqtobeToday } from "@/lib/tz";
import {
  addDays,
  completionDate,
  daysBetween,
  periodForecast,
  rateWindow,
  scenarios,
  type DayVolume,
  type Flow,
  type PeriodForecastRow,
  type RateWindow,
  type Scenarios,
} from "@/lib/forecast";

export interface ForecastSettings {
  baseline_date: string;
  baseline_volume_m3: number;
  target_volume_m3: number;
  target_date: string | null;
  trucks_per_excavator: number;
  availability_coeff: number;
  trips_per_truck_shift: number;
}

export interface VolumeTabData {
  settings: ForecastSettings;
  daily: DayVolume[];
  lastDate: string | null; // последняя дата с данными
  done: number; // накоплено от якоря
  donePct: number;
  remaining: number;
  m3PerTrip: number; // фактическое среднее по сводкам (fallback 19)
  rates: { w7: RateWindow; w14: RateWindow; w30: RateWindow };
  scenarios: Scenarios;
  completion: { pessimistic: string | null; base: string | null; optimistic: string | null };
  periods: PeriodForecastRow[];
  /** отставание (+) / опережение (−) от плана-прямой к цели, дней; null — целевая дата не задана */
  scheduleGapDays: number | null;
  tripsCoveredDays: number; // дней, где объём взят из Рейсов (нет сводки геодезиста)
}

const FLOW_KEYS: Flow[] = ["pit", "local", "stockpile", "prs", "total"];

export async function loadVolumeTabData(): Promise<VolumeTabData> {
  const supabase = await createClient();

  const [settingsRes, factsRes] = await Promise.all([
    supabase.from("forecast_settings").select("*").maybeSingle(),
    fetchAll((f, t) =>
      supabase
        .from("production_facts")
        .select("work_date, shift_type, flow, trips_count, volume_m3, day_status")
        .order("work_date")
        .order("id")
        .range(f, t),
    ),
  ]);
  const s = settingsRes.data;
  const settings: ForecastSettings = {
    baseline_date: s?.baseline_date ?? "2026-07-01",
    baseline_volume_m3: Number(s?.baseline_volume_m3 ?? 150000),
    target_volume_m3: Number(s?.target_volume_m3 ?? 500000),
    target_date: s?.target_date ?? null,
    trucks_per_excavator: s?.trucks_per_excavator ?? 10,
    availability_coeff: Number(s?.availability_coeff ?? 0.75),
    trips_per_truck_shift: s?.trips_per_truck_shift ?? 15,
  };

  // Дневная свод по сводкам геодезиста
  const factDays = new Map<string, DayVolume>();
  let m3Sum = 0;
  let tripsSum = 0;
  for (const f of factsRes) {
    const d = factDays.get(f.work_date) ?? {
      date: f.work_date, volume: 0, downtime: false, source: "facts" as const, flows: {},
    };
    const vol = Number(f.volume_m3 ?? 0);
    d.volume += vol;
    if (f.day_status !== "work") d.downtime = true;
    const flow = (f.flow ?? "total") as Flow;
    if (vol > 0) d.flows[flow] = (d.flows[flow] ?? 0) + vol;
    factDays.set(f.work_date, d);
    if (f.trips_count && f.volume_m3) { tripsSum += f.trips_count; m3Sum += vol; }
  }
  const m3PerTrip = tripsSum > 0 ? Math.round((m3Sum / tripsSum) * 10) / 10 : 19;

  // Дни без сводки — объём из Рейсов × средний м³/рейс
  const trips = await fetchAll((f, t) =>
    supabase.from("trip_records").select("created_at").order("id").range(f, t),
  );
  const tripDays = new Map<string, number>();
  for (const t of trips) {
    const d = aqtobeDate(t.created_at);
    tripDays.set(d, (tripDays.get(d) ?? 0) + 1);
  }
  let tripsCoveredDays = 0;
  for (const [date, n] of tripDays) {
    if (factDays.has(date)) continue;
    tripsCoveredDays++;
    const vol = Math.round(n * m3PerTrip);
    factDays.set(date, { date, volume: vol, downtime: false, source: "trips", flows: { total: vol } });
  }

  const daily = [...factDays.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const d of daily) {
    d.volume = Math.round(d.volume);
    for (const k of FLOW_KEYS) if (d.flows[k]) d.flows[k] = Math.round(d.flows[k]!);
  }
  const lastDate = daily.length ? daily[daily.length - 1].date : null;

  const done = Math.round(
    settings.baseline_volume_m3 +
      daily.filter((d) => d.date >= settings.baseline_date).reduce((a, d) => a + d.volume, 0),
  );
  const remaining = Math.max(0, Math.round(settings.target_volume_m3 - done));
  const donePct = Math.min(100, Math.round((done / settings.target_volume_m3) * 100));

  const effLast = lastDate ?? aqtobeToday();
  const sc = scenarios(daily, effLast);
  const completion = {
    pessimistic: completionDate(effLast, remaining, sc.pessimistic),
    base: completionDate(effLast, remaining, sc.base),
    optimistic: completionDate(effLast, remaining, sc.optimistic),
  };

  // Отставание от плана: где мы должны быть сегодня по прямой якорь→цель
  let scheduleGapDays: number | null = null;
  if (settings.target_date) {
    const totalDays = daysBetween(settings.baseline_date, settings.target_date);
    if (totalDays > 0 && sc.base) {
      const elapsed = daysBetween(settings.baseline_date, effLast);
      const planned =
        settings.baseline_volume_m3 +
        ((settings.target_volume_m3 - settings.baseline_volume_m3) * elapsed) / totalDays;
      scheduleGapDays = Math.round((planned - done) / sc.base); // + отстаём, − опережаем
    }
  }

  return {
    settings,
    daily,
    lastDate,
    done,
    donePct,
    remaining,
    m3PerTrip,
    rates: {
      w7: rateWindow(daily, effLast, 7),
      w14: rateWindow(daily, effLast, 14),
      w30: rateWindow(daily, effLast, 30),
    },
    scenarios: sc,
    completion,
    periods: periodForecast(effLast, done, settings.target_volume_m3, sc),
    scheduleGapDays,
    tripsCoveredDays,
  };
}

/** Журнал сводок для страницы ввода (последние дни, сгруппировано по дате). */
export interface FactRow {
  id: string;
  work_date: string;
  shift_type: string | null;
  flow: string | null;
  trips_count: number | null;
  volume_m3: number | null;
  day_status: string;
  note: string | null;
}

export async function loadRecentFacts(limit = 120): Promise<FactRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_facts")
    .select("id, work_date, shift_type, flow, trips_count, volume_m3, day_status, note")
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as FactRow[];
}

export { addDays };
