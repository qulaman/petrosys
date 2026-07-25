import { AppShell } from "@/components/app-shell";
import { JournalFilters } from "@/components/journals/journal-filters";
import { VolumeJournal } from "@/components/journals/volume-journal";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { resolvePeriod } from "@/lib/journals/period";
import { loadVolumeJournal } from "@/lib/data/journals";
import { aqtobeToday } from "@/lib/tz";

export const metadata = { title: "Журнал объёма" };

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function VolumeJournalPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const period = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) });

  const [rows, current] = await Promise.all([
    loadVolumeJournal({
      fromDate: period.fromDate,
      toDate: period.toDate,
      shift: first(sp.shift) ?? null,
      flow: first(sp.flow) ?? null,
    }),
    getCurrentProfile(),
  ]);
  const roles = current?.profile?.roles ?? [];
  // Правка — офис/админ (как в RLS на production_facts); ввод и удаление — ещё и ИТР.
  const canEdit = ["office", "admin"].some((r) => roles.includes(r));
  const canManage = canEdit || roles.includes("itr");

  return (
    <AppShell requiredRoles={["itr", "office", "admin"]} title="Журнал объёма">
      <div className="flex flex-col gap-4">
        <JournalFilters shiftFlow />
        <VolumeJournal rows={rows} today={aqtobeToday()} canEdit={canEdit} canManage={canManage} />
      </div>
    </AppShell>
  );
}
