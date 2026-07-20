/**
 * Чистая логика модуля прогнозирования объёмов (м³). Без БД и дат «сейчас» —
 * всё приходит параметрами, чтобы легко проверять руками.
 *
 * Правила (утверждены заказчиком в ТЗ прогноза):
 *  - день без данных ≠ 0: пробелы отчётности исключаются из знаменателя темпа;
 *  - простой (погода/техника) в средний темп рабочих дней не входит,
 *    но пессимистичный сценарий считает по календарю — с простоями;
 *  - три сценария: пессимистичный / базовый / оптимистичный.
 */

export type Flow = "pit" | "local" | "stockpile" | "prs" | "total";

export const FLOW_LABELS: Record<Flow, string> = {
  pit: "С карьера",
  local: "По месту",
  stockpile: "С накопителя",
  prs: "ПРС",
  total: "Без детализации",
};

export interface DayVolume {
  date: string; // YYYY-MM-DD
  volume: number; // м³ за день (0 при простое)
  downtime: boolean; // явный простой
  source: "facts" | "trips";
  flows: Partial<Record<Flow, number>>;
}

export interface RateWindow {
  days: number; // размер окна, календарных дней
  avg: number | null; // средний темп по рабочим дням окна
  min: number | null;
  median: number | null;
  max: number | null;
  workDays: number; // рабочих дней с данными в окне
}

const r0 = (x: number) => Math.round(x);

/** Скользящее окно от lastDate назад: темп по рабочим дням (простои и пробелы — вне знаменателя). */
export function rateWindow(daily: DayVolume[], lastDate: string, days: number): RateWindow {
  const from = addDays(lastDate, -(days - 1));
  const vols = daily
    .filter((d) => d.date >= from && d.date <= lastDate && !d.downtime && d.volume > 0)
    .map((d) => d.volume)
    .sort((a, b) => a - b);
  if (!vols.length) return { days, avg: null, min: null, median: null, max: null, workDays: 0 };
  const sum = vols.reduce((a, b) => a + b, 0);
  return {
    days,
    avg: r0(sum / vols.length),
    min: r0(vols[0]),
    median: r0(vols[Math.floor((vols.length - 1) / 2)]),
    max: r0(vols[vols.length - 1]),
    workDays: vols.length,
  };
}

export interface Scenarios {
  /** м³/сутки; null — данных не хватает */
  pessimistic: number | null; // календарное среднее последних 14 дней (с простоями и пробелами как 0 — консервативно)
  base: number | null; // среднее по рабочим дням за 14
  optimistic: number | null; // 75-й перцентиль рабочих дней за 30
}

export function scenarios(daily: DayVolume[], lastDate: string): Scenarios {
  const w14 = rateWindow(daily, lastDate, 14);
  const from14 = addDays(lastDate, -13);
  const cal = daily.filter((d) => d.date >= from14 && d.date <= lastDate);
  const calSum = cal.reduce((a, d) => a + d.volume, 0);
  const pessimistic = cal.length ? r0(calSum / 14) : null;

  const from30 = addDays(lastDate, -29);
  const w30vols = daily
    .filter((d) => d.date >= from30 && d.date <= lastDate && !d.downtime && d.volume > 0)
    .map((d) => d.volume)
    .sort((a, b) => a - b);
  const optimistic = w30vols.length
    ? r0(w30vols[Math.min(w30vols.length - 1, Math.floor(w30vols.length * 0.75))])
    : null;

  return { pessimistic: pessimistic || null, base: w14.avg, optimistic };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** Дата завершения при темпе rate: null, если темп неизвестен или ≤ 0. */
export function completionDate(lastDate: string, remaining: number, rate: number | null): string | null {
  if (!rate || rate <= 0) return null;
  if (remaining <= 0) return lastDate;
  return addDays(lastDate, Math.ceil(remaining / rate));
}

export interface PeriodForecastRow {
  label: string; // «21–27 июл»
  endDate: string;
  pessimistic: number | null; // накопительный объём к концу периода
  base: number | null;
  optimistic: number | null;
  donePct: number | null; // % цели по базовому
}

/** Прогноз накопительного объёма по неделям вперёд до достижения цели (макс. 16 недель). */
export function periodForecast(
  lastDate: string,
  doneVolume: number,
  target: number,
  sc: Scenarios,
): PeriodForecastRow[] {
  const rows: PeriodForecastRow[] = [];
  const fmt = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short", timeZone: "UTC" });
  for (let w = 1; w <= 16; w++) {
    const end = addDays(lastDate, w * 7);
    const start = addDays(lastDate, (w - 1) * 7 + 1);
    const cum = (rate: number | null) =>
      rate == null ? null : Math.min(target, r0(doneVolume + rate * w * 7));
    const base = cum(sc.base);
    rows.push({
      label: `${fmt.format(new Date(`${start}T00:00:00Z`))} — ${fmt.format(new Date(`${end}T00:00:00Z`))}`,
      endDate: end,
      pessimistic: cum(sc.pessimistic),
      base,
      optimistic: cum(sc.optimistic),
      donePct: base == null ? null : Math.min(100, Math.round((base / target) * 100)),
    });
    if (base != null && base >= target) break;
    if (base == null && w >= 8) break;
  }
  return rows;
}

export interface EquipmentPlan {
  requiredRate: number; // м³/сутки, чтобы успеть
  gapRate: number; // разрыв с базовым темпом (может быть ≤ 0 — успеваем)
  extraTripsPerDay: number;
  extraTrucks: { min: number; max: number };
  extraExcavators: { min: number; max: number };
}

/**
 * Сколько техники нужно добавить, чтобы успеть к target_date.
 * Диапазон: min — техника работает в 2 смены, max — в одну, с учётом
 * коэффициента доступности. Оценка, не точное число.
 */
export function equipmentPlan(params: {
  remaining: number;
  lastDate: string;
  targetDate: string;
  baseRate: number;
  m3PerTrip: number;
  tripsPerTruckShift: number;
  trucksPerExcavator: number;
  availability: number;
}): EquipmentPlan | null {
  const days = daysBetween(params.lastDate, params.targetDate);
  if (days <= 0 || params.m3PerTrip <= 0 || params.tripsPerTruckShift <= 0) return null;
  const requiredRate = r0(params.remaining / days);
  const gapRate = requiredRate - params.baseRate;
  const extraTripsPerDay = Math.max(0, Math.ceil(gapRate / params.m3PerTrip));
  const perTruckDay2 = params.tripsPerTruckShift * 2 * params.availability; // 2 смены
  const perTruckDay1 = params.tripsPerTruckShift * params.availability; // 1 смена
  const trucksMin = extraTripsPerDay > 0 ? Math.ceil(extraTripsPerDay / perTruckDay2) : 0;
  const trucksMax = extraTripsPerDay > 0 ? Math.ceil(extraTripsPerDay / perTruckDay1) : 0;
  const exc = (t: number) => (t > 0 ? Math.max(1, Math.ceil(t / params.trucksPerExcavator)) : 0);
  return {
    requiredRate,
    gapRate,
    extraTripsPerDay,
    extraTrucks: { min: trucksMin, max: trucksMax },
    extraExcavators: { min: exc(trucksMin), max: exc(trucksMax) },
  };
}

/** Обратная задача: дата завершения при N самосвалах на линии. */
export function completionWithTrucks(params: {
  remaining: number;
  lastDate: string;
  trucks: number;
  shifts: 1 | 2;
  m3PerTrip: number;
  tripsPerTruckShift: number;
  availability: number;
}): { rate: number; date: string } | null {
  const rate = r0(
    params.trucks * params.tripsPerTruckShift * params.shifts * params.availability * params.m3PerTrip,
  );
  const date = completionDate(params.lastDate, params.remaining, rate);
  return date ? { rate, date } : null;
}
