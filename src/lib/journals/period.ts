/**
 * Разрешение периода из URL-параметров для журналов и (позже) дашборда.
 * Все границы — в часовом поясе объекта Asia/Aqtobe (UTC+5).
 */
export type PeriodPreset = "today" | "7d" | "15d" | "month" | "custom";

export interface ResolvedPeriod {
  preset: PeriodPreset;
  fromDate: string; // yyyy-mm-dd (включительно)
  toDate: string; // yyyy-mm-dd (включительно)
  fromISO: string; // граница для created_at >= fromISO
  toISO: string; // граница для created_at < toISO (следующий день)
}

const TZ_OFFSET = "+05:00";

function aqtobeToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Aqtobe",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function firstOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 8)}01`;
}

function firstOfNextMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

export function resolvePeriod(params: {
  period?: string;
  from?: string;
  to?: string;
}): ResolvedPeriod {
  const today = aqtobeToday();
  const preset = (params.period as PeriodPreset) || "month";

  let fromDate = firstOfMonth(today);
  let toExclusive = firstOfNextMonth(today);

  if (preset === "today") {
    fromDate = today;
    toExclusive = addDays(today, 1);
  } else if (preset === "7d") {
    fromDate = addDays(today, -6);
    toExclusive = addDays(today, 1);
  } else if (preset === "15d") {
    fromDate = addDays(today, -14);
    toExclusive = addDays(today, 1);
  } else if (preset === "custom") {
    fromDate = params.from || today;
    const to = params.to || today;
    toExclusive = addDays(to, 1);
  }

  const toDate = addDays(toExclusive, -1);
  return {
    preset,
    fromDate,
    toDate,
    fromISO: `${fromDate}T00:00:00${TZ_OFFSET}`,
    toISO: `${toExclusive}T00:00:00${TZ_OFFSET}`,
  };
}

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: "Сегодня",
  "7d": "7 дней",
  "15d": "15 дней",
  month: "Месяц",
  custom: "Период",
};
