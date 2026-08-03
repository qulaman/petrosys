"use client";

import { useEffect, useRef } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle, BookOpen, Calculator, ClipboardList, CreditCard, Droplet, FileSignature,
  FileText, FileType2, Fuel, History, Home, LayoutDashboard, Loader2, Mountain, QrCode,
  Settings, SlidersHorizontal, Truck, User, Users, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  fuel: Droplet,
  // Бензовоз — Fuel: в заголовке экрана уже стоит она, а Truck занят «Рейсами».
  tanker: Fuel,
  shifts: ClipboardList,
  trips: Truck,
  volume: Mountain,
  journals: BookOpen,
  settlement: Calculator,
  documents: FileText,
  admin: Settings,
  portal: User,
  home: Home,
};

/** Иконка текущего экрана для заголовка страницы: первый префикс-матч по пути. */
const ROUTE_ICONS: [string, LucideIcon][] = [
  ["/fleet/dashboard/anomalies", AlertTriangle],
  ["/fleet/dashboard", LayoutDashboard],
  ["/fleet/fuel/issue", Droplet],
  ["/fleet/fuel/tanker", Fuel],
  ["/fleet/shifts", ClipboardList],
  ["/fleet/trips", Truck],
  ["/fleet/volume", Mountain],
  ["/fleet/admin/forecast", Mountain],
  ["/fleet/journals/fuel", Droplet],
  ["/fleet/journals/shifts", ClipboardList],
  ["/fleet/journals/trips", Truck],
  ["/fleet/journals/volume", Mountain],
  ["/fleet/journals", BookOpen],
  ["/fleet/office/settlement", Calculator],
  ["/fleet/office/documents", FileText],
  ["/fleet/admin/settings", SlidersHorizontal],
  ["/fleet/admin/audit", History],
  ["/fleet/admin/users", Users],
  ["/fleet/admin/qr", QrCode],
  ["/fleet/admin/contracts", FileSignature],
  ["/fleet/admin/templates", FileType2],
  ["/fleet/admin/fuel_cards", CreditCard],
  ["/fleet/admin", Settings],
  ["/portal/trips", Truck],
  ["/portal/shifts", ClipboardList],
  ["/portal/fuel", Droplet],
  ["/portal/documents", FileText],
  ["/portal", Home],
];

/** Иконка активного экрана рядом с h1 (совпадает с иконкой в меню). */
export function TitleIcon({ className }: { className?: string }) {
  const path = usePathname();
  const found = ROUTE_ICONS.find(([p]) => path === p || path.startsWith(p + "/"))?.[1] ?? ROUTE_ICONS.find(([p]) => path.startsWith(p))?.[1];
  if (!found) return null;
  const Icon = found;
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-md bg-primary/10 p-1.5 text-primary", className)}>
      <Icon className="size-4" />
    </span>
  );
}

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Подсвечивать только при точном совпадении пути (хабы вроде /portal). */
  exact?: boolean;
}

/** Иконка пункта меню: пока грузится переход — крутится спиннер вместо иконки. */
function PendingIcon({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 className={cn(className, "animate-spin")} /> : <Icon className={className} />;
}

export function NavBar({ items, variant }: { items: NavItem[]; variant: "top" | "bottom" }) {
  const path = usePathname();
  const active = (n: NavItem) =>
    n.exact ? path === n.href : path === n.href || (n.href !== "/" && path.startsWith(n.href + "/"));

  const boxRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  // Десять пунктов на телефоне не помещаются и уезжают в горизонтальную
  // прокрутку — активный экран оставался за краем и выглядел «непобеждённым».
  useEffect(() => {
    const box = boxRef.current;
    const el = activeRef.current;
    if (!box || !el || box.scrollWidth <= box.clientWidth) return;
    box.scrollTo({ left: Math.max(0, el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2) });
  }, [path]);

  if (variant === "bottom") {
    return (
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid border-t bg-background pb-[env(safe-area-inset-bottom)]"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active(n) ? "page" : undefined}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium",
              active(n) ? "text-primary" : "text-muted-foreground",
            )}
          >
            {/* Активный пункт отличался только цветом. Подложка под иконкой —
                второй признак: он виден и под ярким солнцем, и при дальтонизме. */}
            <span
              className={cn(
                "grid place-items-center rounded-full px-3 py-0.5",
                active(n) ? "bg-primary/12" : "",
              )}
            >
              <PendingIcon icon={ICONS[n.icon] ?? Truck} className="size-6" />
            </span>
            {n.label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav ref={boxRef} className="relative flex h-11 items-center gap-1 overflow-x-auto border-b px-2">
      {items.map((n) => (
        <Link
          key={n.href}
          ref={active(n) ? activeRef : undefined}
          href={n.href}
          aria-current={active(n) ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium",
            active(n) ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <PendingIcon
            icon={ICONS[n.icon] ?? Truck}
            className={cn("size-4 shrink-0", active(n) ? "text-primary" : "")}
          />
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
