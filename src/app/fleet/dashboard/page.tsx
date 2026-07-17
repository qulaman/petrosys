import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { loadTodayData, loadFuelTabData, loadWorkTabData, loadMoneyTabData } from "@/lib/data/dashboard";
import { resolvePeriod } from "@/lib/journals/period";
import { PeriodSelector } from "@/components/period-selector";
import { DashboardNav } from "./dashboard-nav";
import { TodayTab } from "./today-tab";
import { FuelTab } from "./fuel-tab";
import { WorkTab } from "./work-tab";
import { MoneyTab } from "./money-tab";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const tab = first(sp.tab) || "today";

  const period = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) });

  const supabase = await createClient();
  // Счётчик аномалий и данные активной вкладки — параллельно.
  const countPromise = supabase
    .from("anomalies")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  const tabPromise =
    tab === "today"
      ? loadTodayData()
      : tab === "fuel"
        ? loadFuelTabData(period)
        : tab === "work"
          ? loadWorkTabData(period)
          : loadMoneyTabData(period);
  const [{ count }, tabData] = await Promise.all([countPromise, tabPromise]);

  return (
    <AppShell requiredRoles={["admin", "office"]} title="Дашборд">
      <div className="flex flex-col gap-4">
        <DashboardNav active={tab} newAnomalies={count ?? 0} />
        {tab === "today" ? (
          <TodayTab data={tabData as Awaited<ReturnType<typeof loadTodayData>>} />
        ) : (
          <>
            <PeriodSelector extraParams={{ tab }} />
            {tab === "fuel" ? (
              <FuelTab data={tabData as Awaited<ReturnType<typeof loadFuelTabData>>} />
            ) : tab === "work" ? (
              <WorkTab data={tabData as Awaited<ReturnType<typeof loadWorkTabData>>} />
            ) : tab === "money" ? (
              <MoneyTab data={tabData as Awaited<ReturnType<typeof loadMoneyTabData>>} />
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
