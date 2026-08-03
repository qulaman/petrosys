import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Изменение показателя к базе сравнения — мягкая плашка со стрелкой.
 * База задаётся вызывающим: «ко вчера к этому часу» на «Сегодня»,
 * «к прошлому периоду» на «Работе».
 */
export function Delta({
  now,
  prev,
  fmt = fmtInt,
  suffix,
  title,
}: {
  now: number;
  prev: number;
  fmt?: (n: number) => string;
  /** Хвост подписи: чего именно касается сравнение. */
  suffix: string;
  title?: string;
}) {
  const diff = now - prev;
  // Сравнивать нечего: показателя нет ни сейчас, ни в базе.
  if (prev === 0 && now === 0) return null;

  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  const tone =
    diff > 0 ? "bg-success/10 text-success" : diff < 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";

  return (
    <span
      className={cn("relative inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums", tone)}
      title={[title, suffix].filter(Boolean).join(" · ")}
    >
      <Icon className="size-3 shrink-0" />
      {diff > 0 ? "+" : ""}
      {fmt(diff)}
      {/* В узкой плитке хвост разворачивал бейдж на три строки — на телефоне
          остаётся только число, пояснение живёт в подсказке. */}
      <span className="hidden font-normal opacity-75 sm:inline">{suffix}</span>
    </span>
  );
}
