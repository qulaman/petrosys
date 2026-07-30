import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Плитка раздела справочников: иконка, название, пояснение и счётчик записей.
 * Пояснение нужно, чтобы не открывать раздел ради того, чтобы понять, что внутри.
 */
export function AdminCard({
  href,
  title,
  description,
  icon: Icon,
  count,
  note,
}: {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Всего записей; не задан — раздел без списка (инструмент, настройки). */
  count?: number;
  /** Подпись под счётчиком, например «12 скрыто». */
  note?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors",
        "hover:border-primary/40 hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        <Icon className="size-5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>

      {count !== undefined ? (
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums">{count}</span>
          {note ? (
            <span className="block text-xs leading-tight text-muted-foreground">{note}</span>
          ) : null}
        </span>
      ) : null}

      <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </Link>
  );
}
