import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Плитка сводки дашборда — один компонент на все вкладки.
 * Раньше в каждой вкладке лежала своя копия, и они разъехались: где-то не было
 * h-full (рваная нижняя кромка ряда), где-то ссылки, где-то другой кегль цифры.
 *
 * Крупное значение — пропорциональными цифрами: tabular-nums на 30px даёт
 * рыхлые пробелы и нужен только там, где числа выравниваются по вертикали.
 */

export type StatTone = "default" | "primary" | "success" | "warning" | "info";

const TONES: Record<StatTone, { chip: string; border: string; wash: string }> = {
  default: { chip: "bg-muted text-muted-foreground", border: "", wash: "" },
  primary: { chip: "bg-primary/10 text-primary", border: "border-primary/40", wash: "var(--primary)" },
  success: { chip: "bg-success/10 text-success", border: "border-success/40", wash: "var(--success)" },
  warning: { chip: "bg-warning/10 text-warning", border: "border-warning/40", wash: "var(--warning)" },
  info: { chip: "bg-info/10 text-info", border: "border-info/40", wash: "var(--info)" },
};

export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  href,
  delta,
  tone = "default",
  title,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon: React.ElementType;
  /** Плитка становится ссылкой: подсветка, стрелка и фокус с клавиатуры. */
  href?: string;
  delta?: React.ReactNode;
  tone?: StatTone;
  title?: string;
}) {
  const t = TONES[tone];
  const body = (
    <div
      className={cn(
        "group relative flex h-full flex-col gap-2 overflow-hidden rounded-xl border bg-card p-4",
        t.border,
        href && "transition-colors hover:bg-accent",
      )}
    >
      {/* Мягкая подцветка угла — только у тонированных плиток. */}
      {t.wash ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(120% 120% at 100% 0%, color-mix(in srgb, ${t.wash} 8%, transparent), transparent 62%)`,
          }}
        />
      ) : null}

      <div className="relative flex items-center gap-2">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", t.chip)}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 text-xs font-medium text-muted-foreground">{label}</span>
        {href ? (
          <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        ) : null}
      </div>

      {/* break-words обязателен: разряды в ru-RU разделены НЕразрывным пробелом,
          и «10 897 045 ₸» не переносилось — в узкой плитке цифру просто срезало
          по overflow-hidden, без многоточия и без подсказки. */}
      <span className="relative text-xl font-semibold leading-tight tracking-tight break-words sm:text-2xl lg:text-3xl">
        {value}
      </span>
      {delta}
      {sub ? <span className="relative text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );

  return href ? (
    <Link href={href} title={title} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
