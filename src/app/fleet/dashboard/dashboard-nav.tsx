"use client";

import Link, { useLinkStatus } from "next/link";
import { Activity, AlertTriangle, Droplet, Loader2, Mountain, Timer, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "today", label: "Сегодня", icon: Activity },
  { key: "fuel", label: "Топливо", icon: Droplet },
  { key: "work", label: "Работа", icon: Timer },
  { key: "volume", label: "Объём", icon: Mountain },
  { key: "money", label: "Подрядчики и деньги", icon: Wallet },
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
  badge,
}: {
  active: string;
  /** Счётчик новых аномалий — серверный слот, стримится после первого рендера. */
  badge?: React.ReactNode;
}) {
  return (
    <div className="sticky top-[var(--app-sticky-top)] z-30 flex flex-wrap items-center gap-2 border-b bg-background pb-2 pt-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/fleet/dashboard?tab=${t.key}`}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
            active === t.key ? "bg-accent" : "hover:bg-accent",
          )}
        >
          <t.icon className={cn("size-4 shrink-0", active === t.key ? "text-primary" : "text-muted-foreground")} />
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
        {badge}
        <LinkSpinner />
      </Link>
    </div>
  );
}
