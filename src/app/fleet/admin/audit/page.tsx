import { AppShell } from "@/components/app-shell";
import { PeriodSelector } from "@/components/period-selector";
import { resolvePeriod } from "@/lib/journals/period";
import { loadAuditPage } from "@/lib/data/audit";
import { AuditClient } from "./audit-client";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const period = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) });
  const filters = {
    section: first(sp.section) || null,
    action: first(sp.action) || null,
    userId: first(sp.user) || null,
  };
  const page = Math.max(0, parseInt(first(sp.page) ?? "0", 10) || 0);
  const data = await loadAuditPage({ period, ...filters, page });

  return (
    <AppShell requiredRoles={["admin", "office"]} title="Журнал изменений">
      <div className="flex flex-col gap-4">
        <PeriodSelector extraParams={{ ...(filters.section ? { section: filters.section } : {}), ...(filters.action ? { action: filters.action } : {}), ...(filters.userId ? { user: filters.userId } : {}) }} />
        <AuditClient data={data} filters={filters} />
      </div>
    </AppShell>
  );
}
