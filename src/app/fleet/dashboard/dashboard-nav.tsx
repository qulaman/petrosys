"use client";

import { useEffect, useRef } from "react";
import Link, { useLinkStatus } from "next/link";
import { useSearchParams } from "next/navigation";
import { Activity, AlertTriangle, Droplet, Loader2, Mountain, Timer, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Параметры периода переносятся между вкладками: иначе каждый переход сбрасывал выбор. */
const CARRIED = ["period", "from", "to"] as const;

const TABS: { key: string; label: string; title?: string; icon: LucideIcon }[] = [
  { key: "today", label: "Сегодня", icon: Activity },
  { key: "fuel", label: "Топливо", icon: Droplet },
  { key: "work", label: "Работа", icon: Timer },
  { key: "volume", label: "Объём", icon: Mountain },
  // Короткая подпись: «Подрядчики и деньги» в полтора раза шире любой другой
  // вкладки и на телефоне в одиночку уводила строку на второй перенос.
  { key: "money", label: "Деньги", title: "Подрядчики и деньги", icon: Wallet },
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
  const sp = useSearchParams();
  const boxRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // На телефоне вкладки не переносятся, а прокручиваются: перенос давал три
  // строки закреплённой панели — треть экрана уходила под навигацию.
  // Активную вкладку подводим в центр, иначе она остаётся за краем.
  useEffect(() => {
    const box = boxRef.current;
    const el = activeRef.current;
    if (!box || !el || box.scrollWidth <= box.clientWidth) return;
    box.scrollTo({ left: Math.max(0, el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2) });
  }, [active]);

  const tabHref = (key: string) => {
    const p = new URLSearchParams();
    p.set("tab", key);
    for (const k of CARRIED) {
      const v = sp.get(k);
      if (v) p.set(k, v);
    }
    return `/fleet/dashboard?${p.toString()}`;
  };

  return (
    <div
      ref={boxRef}
      className="sticky top-[var(--app-sticky-top)] z-30 -mx-4 flex items-center gap-2 overflow-x-auto border-b bg-background px-4 pb-2 pt-1 sm:mx-0 sm:flex-wrap sm:overflow-x-visible sm:px-0"
    >
      {TABS.map((t) => (
        <Link
          key={t.key}
          ref={active === t.key ? activeRef : undefined}
          href={tabHref(t.key)}
          title={t.title}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium sm:min-h-0 sm:py-1.5",
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
        aria-label="Аномалии"
        className="ml-auto flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent sm:min-h-0 sm:py-1.5"
      >
        <AlertTriangle className="size-4 text-warning" />
        <span className="hidden sm:inline">Аномалии</span>
        {badge}
        <LinkSpinner />
      </Link>
    </div>
  );
}
