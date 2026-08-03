import { TIME_ZONE } from "@/lib/format";

/**
 * Разрешение периода из URL-параметров для журналов, дашборда и расчётов.
 * Все границы — в часовом поясе объекта Asia/Aqtobe (UTC+5).
 */
export type PeriodPreset = "today" | "7d" | "15d" | "month" | "prev_month" | "custom";

export interface ResolvedPeriod {
  /** Уже нормализованный пресет: мусор в адресе приводится к дефолту. */
  preset: PeriodPreset;
  fromDate: string; // yyyy-mm-dd (включительно)
  toDate: string; // yyyy-mm-dd (включительно) — номинальная граница периода
  /**
   * Последний уже НАСТУПИВШИЙ день периода: min(toDate, сегодня), но не раньше
   * fromDate. Витрины (графики по дням, тепловые карты, выгрузки) строятся до
   * него — иначе «Этот месяц» третьего числа рисовал 28 пустых колонок вперёд.
   * Прогнозы, наоборот, считают до toDate: месяц закрывается целиком.
   */
  dataToDate: string;
  todayDate: string;
  fromISO: string; // граница для created_at >= fromISO
  toISO: string; // граница для created_at < toISO (следующий день после toDate)
}

/** База сравнения показателей — предыдущий сопоставимый отрезок. */
export interface ComparisonPeriod {
  fromDate: string;
  toDate: string;
  /** Подпись для подсказок: «01.07–03.07». */
  label: string;
}

const TZ_OFFSET = "+05:00";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PERIOD_PRESETS: PeriodPreset[] = ["today", "7d", "15d", "month", "prev_month", "custom"];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: "Сегодня",
  "7d": "7 дней",
  "15d": "15 дней",
  month: "Этот месяц",
  prev_month: "Прошлый месяц",
  custom: "Период",
};

function aqtobeToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Число дней в отрезке включительно; 0, если отрезок вывернут. */
export function countDays(fromDate: string, toDate: string): number {
  const ms = new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.round(ms / 864e5) + 1);
}

/**
 * Дата существует и записана как yyyy-mm-dd. Проверка обязательна: параметр
 * приходит из адресной строки, и «abc» уезжал прямо в запрос как
 * «abcT00:00:00+05:00» — PostgREST падал, а пользователь видел экран ошибки.
 */
export function isIsoDate(v: string | undefined | null): v is string {
  if (!v || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Первое число месяца, сдвинутого на n месяцев от даты. */
function monthStart(dateStr: string, n = 0): string {
  const [y, m] = dateStr.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** Последнее число месяца, которому принадлежит дата. */
function monthEnd(dateStr: string): string {
  return addDays(monthStart(dateStr, 1), -1);
}

export function resolvePeriod(params: {
  period?: string;
  from?: string;
  to?: string;
}): ResolvedPeriod {
  const today = aqtobeToday();
  const preset: PeriodPreset = PERIOD_PRESETS.includes(params.period as PeriodPreset)
    ? (params.period as PeriodPreset)
    : "month";

  let fromDate: string;
  let toDate: string;
  if (preset === "today") {
    fromDate = today;
    toDate = today;
  } else if (preset === "7d") {
    fromDate = addDays(today, -6);
    toDate = today;
  } else if (preset === "15d") {
    fromDate = addDays(today, -14);
    toDate = today;
  } else if (preset === "prev_month") {
    fromDate = monthStart(today, -1);
    toDate = monthEnd(fromDate);
  } else if (preset === "custom") {
    let f = isIsoDate(params.from) ? params.from : today;
    let t = isIsoDate(params.to) ? params.to : today;
    // Вывернутый диапазон разворачиваем, а не отдаём как есть: раньше он давал
    // пустые графики и отрицательный «Прогноз АВР» без единого сообщения.
    if (f > t) [f, t] = [t, f];
    fromDate = f;
    toDate = t;
  } else {
    fromDate = monthStart(today);
    toDate = monthEnd(today);
  }

  const dataToDate = toDate < today ? toDate : today < fromDate ? fromDate : today;
  return {
    preset,
    fromDate,
    toDate,
    dataToDate,
    todayDate: today,
    fromISO: `${fromDate}T00:00:00${TZ_OFFSET}`,
    toISO: `${addDays(toDate, 1)}T00:00:00${TZ_OFFSET}`,
  };
}

const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/**
 * Предыдущий сопоставимый отрезок для Δ на плитках.
 *
 * Сравнивается ПРОШЕДШАЯ часть периода, а не его номинальная длина: «Этот
 * месяц» третьего числа против всего прошлого месяца давал −95 % и читался как
 * обвал производства. Календарные месяцы сравниваются с тем же отрезком
 * предыдущего месяца (1–3 августа ↔ 1–3 июля), скользящие окна — с окном такой
 * же длины вплотную перед началом периода.
 */
export function previousPeriod(p: ResolvedPeriod): ComparisonPeriod {
  const elapsed = Math.max(1, countDays(p.fromDate, p.dataToDate));
  let fromDate: string;
  let toDate: string;
  if (p.preset === "month" || p.preset === "prev_month") {
    fromDate = monthStart(p.fromDate, -1);
    const end = monthEnd(fromDate);
    const wanted = addDays(fromDate, elapsed - 1);
    toDate = wanted > end ? end : wanted;
  } else {
    toDate = addDays(p.fromDate, -1);
    fromDate = addDays(toDate, -(elapsed - 1));
  }
  return {
    fromDate,
    toDate,
    label: fromDate === toDate ? ddmm(fromDate) : `${ddmm(fromDate)}–${ddmm(toDate)}`,
  };
}

/** Человеческая подпись периода для сообщений: «01.08–31.08». */
export function periodLabel(p: { fromDate: string; toDate: string }): string {
  return p.fromDate === p.toDate ? ddmm(p.fromDate) : `${ddmm(p.fromDate)}–${ddmm(p.toDate)}`;
}
