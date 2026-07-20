import { cn } from "@/lib/utils";

export type StatusTone = "amber" | "blue" | "red" | "green" | "muted";

const TONES: Record<StatusTone, string> = {
  amber: "border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400",
  blue: "border-blue-600/30 bg-blue-600/10 text-blue-700 dark:text-blue-400",
  red: "border-destructive/30 bg-destructive/10 text-destructive",
  green: "border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400",
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
