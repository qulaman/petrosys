import { AppShell } from "@/components/app-shell";
import { loadTripsData } from "@/lib/data/trips";
import { TripsClient } from "./trips-client";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Текущая смена по времени Актобе: день 07–19, ночь 19–07 (до 07 утра — ночь вчерашней даты). */
function currentShiftAqtobe(): { date: string; shift: "day" | "night" } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Aqtobe",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = parseInt(get("hour"), 10) % 24;

  if (hour >= 7 && hour < 19) return { date, shift: "day" };
  if (hour >= 19) return { date, shift: "night" };
  // 00:00–06:59 — ещё идёт ночная смена вчерашней даты
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return { date: d.toISOString().slice(0, 10), shift: "night" };
}

export default async function TripsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const auto = currentShiftAqtobe();
  const date = first(sp.date) || auto.date;
  const shiftParam = first(sp.shift);
  const shift = (shiftParam === "night" || shiftParam === "day" ? shiftParam : auto.shift) as
    | "day"
    | "night";

  const data = await loadTripsData(date, shift);
  return (
    <AppShell requiredRoles={["checker", "admin"]} title="Фиксация рейсов">
      <TripsClient data={data} />
    </AppShell>
  );
}
