import {
  Briefcase, Calculator, ClipboardList, CreditCard, Fuel, Moon, Shield, Sun, Truck,
  type LucideIcon,
} from "lucide-react";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

/**
 * Доменные подписи вместе с иконками.
 *
 * Значок закреплён за сущностью один на всё приложение: заправщик узнаёт его на
 * своём экране, офис — в журнале, и это одна и та же вещь. Поэтому карты
 * источников и ролей живут здесь, а не расставляются по экранам вручную.
 *
 * Иконки ролей намеренно не в `lib/auth/roles.ts`: тот модуль тянут серверные
 * пути (proxy, AppShell), и lucide там лишний.
 */

type Shift = "day" | "night";

/**
 * Смена суток. Пара «солнце/луна» различается без чтения — на ярком солнце и в
 * перчатках это важнее подписи: две кнопки рядом отличались одним словом.
 */
export const SHIFT_ICONS: Record<Shift, LucideIcon> = { day: Sun, night: Moon };

const SHIFT_LABELS: Record<Shift, string> = { day: "День", night: "Ночь" };

const asShift = (v: string): Shift => (v === "night" ? "night" : "day");

export function ShiftLabel({ shift, className }: { shift: string; className?: string }) {
  const key = asShift(shift);
  const Icon = SHIFT_ICONS[key];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {SHIFT_LABELS[key]}
    </span>
  );
}

type FuelSource = "card" | "tanker";

/** Те же значки стоят на кнопках выбора источника в выдаче ГСМ. */
export const FUEL_SOURCE_ICONS: Record<FuelSource, LucideIcon> = {
  card: CreditCard,
  tanker: Fuel,
};

const FUEL_SOURCE_LABELS: Record<FuelSource, string> = {
  card: "Карта",
  tanker: "Бензовоз",
};

export function FuelSourceLabel({
  source,
  sub,
  className,
}: {
  source: string;
  /** Уточнение справа: номер карты или имя бензовоза. */
  sub?: string | null;
  className?: string;
}) {
  const key: FuelSource = source === "card" ? "card" : "tanker";
  const Icon = FUEL_SOURCE_ICONS[key];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {FUEL_SOURCE_LABELS[key]}
      {sub ? <span className="text-muted-foreground">· {sub}</span> : null}
    </span>
  );
}

/**
 * Роли. Значок повторяет иконку рабочего экрана роли: заправщик — бензоколонка,
 * ИТР — табель, учётчик — самосвал, офис — калькулятор (как «Закрытие»).
 */
export const ROLE_ICONS: Record<Role, LucideIcon> = {
  admin: Shield,
  office: Calculator,
  fueler: Fuel,
  itr: ClipboardList,
  checker: Truck,
  contractor: Briefcase,
};

export function RoleLabel({ role, className }: { role: string; className?: string }) {
  const Icon = ROLE_ICONS[role as Role];
  const label = ROLE_LABELS[role as Role] ?? role;
  if (!Icon) return <>{label}</>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {label}
    </span>
  );
}
