"use client";

import Link, { useLinkStatus } from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "today", label: "Сегодня" },
  { key: "fuel", label: "Топливо" },
  { key: "work", label: "Работа" },
  { key: "money", label: "Подрядчики и деньги" },
];

/** Спиннер внутри <Link>, пока грузится страница назначения (фикс. ширина — без прыжков). */
function LinkSpinner() {
  const { pending } = useLinkStatus();
  return (
    <Loader2
      className={cn("size-3.5 shrink-0 animate-spin transition-opacity", pending ? "opacity-100" : "opacity-0")}
      aria-hidden
    />
  );
}

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
            "flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium",
            active === t.key ? "bg-accent" : "hover:bg-accent",
          )}
        >
          {t.label}
          <LinkSpinner />
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
        <LinkSpinner />
      </Link>
    </div>
  );
}
