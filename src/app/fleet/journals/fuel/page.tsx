import { AppShell } from "@/components/app-shell";
import { JournalFilters } from "@/components/journals/journal-filters";
import { FuelJournal } from "@/components/journals/fuel-journal";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { resolvePeriod } from "@/lib/journals/period";
import { loadFilterOptions, loadFuelJournal } from "@/lib/data/journals";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function FuelJournalPage({ searchParams }: { searchParams: Promise<SP> }) {
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
    loadFuelJournal(filters),
    getCurrentProfile(),
  ]);
  const isAdmin = current?.profile?.roles.includes("admin") ?? false;

  return (
    <AppShell requiredRoles={["office", "admin"]} title="Журнал выдачи ГСМ">
      <div className="flex flex-col gap-4">
        <JournalFilters options={options} />
        <FuelJournal rows={rows} isAdmin={isAdmin} drivers={options.drivers} vehicles={options.vehicles} />
      </div>
    </AppShell>
  );
}
