import { cn } from "@/lib/utils";

/**
 * Тон статуса называется по смыслу, а не по цвету: цвет зависит от темы
 * (в режиме «Солнце» он темнее), а смысл — нет.
 */
export type StatusTone = "success" | "warning" | "info" | "danger" | "muted";

const TONES: Record<StatusTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  info: "border-info/30 bg-info/10 text-info",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

/** Капсула статуса с цветной точкой — единый вид статусов по всему приложению. */
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
