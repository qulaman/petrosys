import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
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

export const metadata = { title: "Дашборд" };

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
        <Suspense key={`${tab}|${period.fromDate}|${period.toDate}`} fallback={<TabSkeleton tab={tab} />}>
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
  return <span className="rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground">{count}</span>;
}

async function TabContent({ tab, period }: { tab: string; period: ResolvedPeriod }) {
  if (tab === "fuel") return <FuelTab data={await loadFuelTabData(period)} />;
  if (tab === "work") return <WorkTab data={await loadWorkTabData(period)} />;
  if (tab === "money") return <MoneyTab data={await loadMoneyTabData(period)} />;
  if (tab === "volume") return <VolumeTab data={await loadVolumeTabData()} />;
  return <TodayTab data={await loadTodayData()} />;
}

/**
 * Заглушка по форме конкретной вкладки: общая на всех давала заметный прыжок
 * вёрстки, когда приезжало содержимое другой высоты и с другим числом плиток.
 */
function TabSkeleton({ tab }: { tab: string }) {
  const tiles = tab === "today" || tab === "volume" || tab === "money" ? 5 : 4;
  return (
    <div className="flex flex-col gap-6">
      <div className={cn("grid grid-cols-2 gap-3", tiles === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        {Array.from({ length: tiles }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      {tab === "work" ? (
        <>
          {/* Две тепловые карты и пара графиков в две колонки */}
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-56 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        </>
      ) : (
        <>
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </>
      )}
    </div>
  );
}
