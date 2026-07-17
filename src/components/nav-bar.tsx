"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Droplet, Truck, ClipboardList, BookOpen,
  Calculator, FileText, Settings, User, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  fuel: Droplet,
  tanker: Truck,
  shifts: ClipboardList,
  trips: Truck,
  journals: BookOpen,
  settlement: Calculator,
  documents: FileText,
  admin: Settings,
  portal: User,
};

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export function NavBar({ items, variant }: { items: NavItem[]; variant: "top" | "bottom" }) {
  const path = usePathname();
  const active = (href: string) =>
    path === href || (href !== "/" && path.startsWith(href + "/")) || (href.includes("?") && path === href.split("?")[0]);

  if (variant === "bottom") {
    return (
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid border-t bg-background pb-[env(safe-area-inset-bottom)]"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((n) => {
          const Icon = ICONS[n.icon] ?? Truck;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium",
                active(n.href) ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-6" />
              {n.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
      {items.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={cn(
            "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium",
            active(n.href) ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
