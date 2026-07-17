import { AppShell } from "@/components/app-shell";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { loadShiftJournalData } from "@/lib/data/shifts";
import { ShiftsClient } from "./shifts-client";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function todayAqtobe(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Aqtobe",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const date = first(sp.date) || todayAqtobe();
  const shift = (first(sp.shift) === "night" ? "night" : "day") as "day" | "night";

  const [data, current] = await Promise.all([
    loadShiftJournalData(date, shift),
    getCurrentProfile(),
  ]);
  const isAdmin = current?.profile?.roles.includes("admin") ?? false;

  return (
    <AppShell requiredRoles={["itr", "admin"]} title="Журнал смены">
      <ShiftsClient data={data} isAdmin={isAdmin} />
    </AppShell>
  );
}
