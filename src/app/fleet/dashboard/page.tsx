import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import { loadTodayData, loadFuelTabData, loadWorkTabData, loadMoneyTabData } from "@/lib/data/dashboard";
import { loadVolumeTabData } from "@/lib/data/forecast";
import { VolumeTab } from "./volume-tab";
import { resolvePeriod, type ResolvedPeriod } from "@/lib/journals/period";
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

  // Шапка, табы и селектор периода рендерятся сразу; данные вкладки и бейдж
  // аномалий стримятся через Suspense — переключение вкладок не мигает всей страницей.
  return (
    <AppShell requiredRoles={["admin", "office"]} title="Дашборд">
      <div className="flex flex-col gap-4">
        <DashboardNav
          active={tab}
          badge={
            <Suspense fallback={null}>
              <AnomalyBadge />
            </Suspense>
          }
        />
        {tab !== "today" && tab !== "volume" ? <PeriodSelector extraParams={{ tab }} /> : null}
        <Suspense key={`${tab}|${period.fromDate}|${period.toDate}`} fallback={<TabSkeleton />}>
          <TabContent tab={tab} period={period} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function AnomalyBadge() {
  const supabase = await createClient();
  const { count } = await supabase.from("anomalies").select("id", { count: "exact", head: true }).eq("status", "new");
  if (!count) return null;
  return <span className="rounded-full bg-destructive px-1.5 text-xs font-semibold text-white">{count}</span>;
}

async function TabContent({ tab, period }: { tab: string; period: ResolvedPeriod }) {
  if (tab === "fuel") return <FuelTab data={await loadFuelTabData(period)} />;
  if (tab === "work") return <WorkTab data={await loadWorkTabData(period)} />;
  if (tab === "money") return <MoneyTab data={await loadMoneyTabData(period)} />;
  if (tab === "volume") return <VolumeTab data={await loadVolumeTabData()} />;
  return <TodayTab data={await loadTodayData()} />;
}

function TabSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" />
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
