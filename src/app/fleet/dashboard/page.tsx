import { Suspense } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  loadTodayData, loadFuelTabData, loadWorkTabData, loadMoneyTabData, loadLastActivityDate,
} from "@/lib/data/dashboard";
import { loadVolumeTabData } from "@/lib/data/forecast";
import { VolumeTab } from "./volume-tab";
import { periodLabel, resolvePeriod, type ResolvedPeriod } from "@/lib/journals/period";
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
  if (tab === "fuel") {
    const data = await loadFuelTabData(period);
    return (
      <>
        <EmptyPeriodNotice tab={tab} period={period} empty={data.summary.totalLiters === 0} />
        <FuelTab data={data} />
      </>
    );
  }
  if (tab === "work") {
    const data = await loadWorkTabData(period);
    return (
      <>
        <EmptyPeriodNotice tab={tab} period={period}
          empty={data.summary.tripsTotal === 0 && data.summary.hoursTotal === 0} />
        <WorkTab data={data} />
      </>
    );
  }
  if (tab === "money") {
    const data = await loadMoneyTabData(period);
    return (
      <>
        {/* Работа без ставок даёт нули в деньгах, но период не пуст —
            подсказка «данных нет» там была бы враньём. */}
        <EmptyPeriodNotice tab={tab} period={period}
          empty={data.summary.accrual === 0 && data.summary.fuelHold === 0 && data.unbilledSummary.vehicles === 0} />
        <MoneyTab data={data} />
      </>
    );
  }
  if (tab === "volume") return <VolumeTab data={await loadVolumeTabData()} />;
  return <TodayTab data={await loadTodayData()} />;
}

const MONTH_NAME = new Intl.DateTimeFormat("ru", { month: "long", timeZone: "UTC" });

/**
 * Пустой период — самая частая жалоба на «сломанный фильтр»: пресеты считаются
 * от сегодня, а факты идут за прошлый месяц, и дашборд открывается чистым.
 * Показываем, где данные есть, и уводим туда одним нажатием.
 */
async function EmptyPeriodNotice({ tab, period, empty }: { tab: string; period: ResolvedPeriod; empty: boolean }) {
  if (!empty) return null;
  const last = await loadLastActivityDate();
  // Данных нет и за пределами периода — обычное пустое состояние вкладок.
  if (!last || (last >= period.fromDate && last <= period.toDate)) return null;

  const d = new Date(`${last}T00:00:00Z`);
  const from = `${last.slice(0, 8)}01`;
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const month = MONTH_NAME.format(d);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm">
      <CalendarClock className="size-5 shrink-0 text-warning" />
      <span>
        За период {periodLabel(period)} записей нет. Последняя запись в системе —{" "}
        <span className="font-medium">{last.slice(8, 10)}.{last.slice(5, 7)}</span>.
      </span>
      <Link
        href={`/fleet/dashboard?tab=${tab}&period=custom&from=${from}&to=${to}`}
        className="rounded-md border bg-background px-2.5 py-1 font-medium hover:bg-accent"
      >
        Показать {month}
      </Link>
    </div>
  );
}

/**
 * Заглушка по форме конкретной вкладки: общая на всех давала заметный прыжок
 * вёрстки, когда приезжало содержимое другой высоты и с другим числом плиток.
 */
function TabSkeleton({ tab }: { tab: string }) {
  const tiles = tab === "today" || tab === "volume" || tab === "money" ? 5 : 4;
  return (
    <div className="flex flex-col gap-6">
      <div className={cn("grid grid-cols-2 gap-3", tiles === 5 ? "sm:grid-cols-3 lg:grid-cols-5" : "md:grid-cols-4")}>
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
