import { AppShell } from "@/components/app-shell";
import { JournalFilters } from "@/components/journals/journal-filters";
import { TripJournal } from "@/components/journals/trip-journal";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { resolvePeriod } from "@/lib/journals/period";
import { loadFilterOptions, loadTripJournal } from "@/lib/data/journals";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TripJournalPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const period = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) });
  const filters = {
    fromISO: period.fromISO,
    toISO: period.toISO,
    fromDate: period.fromDate,
    toDate: period.toDate,
    vehicleId: first(sp.vehicle) ?? null,
    contractorId: first(sp.contractor) ?? null,
  };
  const [options, rows, current] = await Promise.all([
    loadFilterOptions(),
    loadTripJournal(filters),
    getCurrentProfile(),
  ]);
  const isAdmin = current?.profile?.roles.includes("admin") ?? false;

  return (
    <AppShell requiredRoles={["office", "admin"]} title="Журнал рейсов">
      <div className="flex flex-col gap-4">
        <JournalFilters options={options} />
        <TripJournal rows={rows} isAdmin={isAdmin} drivers={options.drivers} routes={options.routes} />
      </div>
    </AppShell>
  );
}
