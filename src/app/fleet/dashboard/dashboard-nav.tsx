import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "today", label: "Сегодня" },
  { key: "fuel", label: "Топливо" },
  { key: "work", label: "Работа" },
  { key: "money", label: "Подрядчики и деньги" },
];

export function DashboardNav({
  active,
  newAnomalies,
}: {
  active: string;
  newAnomalies: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b pb-2">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/fleet/dashboard?tab=${t.key}`}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium",
            active === t.key ? "bg-accent" : "hover:bg-accent",
          )}
        >
          {t.label}
        </Link>
      ))}
      <Link
        href="/fleet/dashboard/anomalies"
        className="ml-auto flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
      >
        <AlertTriangle className="size-4 text-amber-600" />
        Аномалии
        {newAnomalies > 0 ? (
          <span className="rounded-full bg-destructive px-1.5 text-xs font-semibold text-white">
            {newAnomalies}
          </span>
        ) : null}
      </Link>
    </div>
  );
}
