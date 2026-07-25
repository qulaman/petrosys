import { cn } from "@/lib/utils";

/**
 * Каркас таблицы — единые рамка, отступы ячеек и поведение при скролле.
 * Разметка повторяет уже сложившийся вид журналов, чтобы таблицы во всех
 * разделах выглядели одинаково.
 *
 * Закреплённая шапка включается только с lg: на узких экранах обёртка
 * прокручивается горизонтально и становится scroll-контейнером, внутри
 * которого `position: sticky` относительно страницы не работает.
 */
export function Table({
  children,
  className,
  stickyHeader = false,
}: {
  children: React.ReactNode;
  className?: string;
  stickyHeader?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-lg border",
        stickyHeader && "lg:overflow-x-visible",
        className,
      )}
    >
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function THead({
  children,
  sticky = false,
}: {
  children: React.ReactNode;
  /** Держать шапку под шапкой приложения при прокрутке длинного списка. */
  sticky?: boolean;
}) {
  return (
    <thead
      className={cn(
        "text-left",
        // Непрозрачный фон обязателен: под закреплённой шапкой проходят строки.
        sticky ? "lg:sticky lg:z-10 bg-muted" : "bg-muted/50",
      )}
      style={sticky ? { top: "var(--app-sticky-top, 0px)" } : undefined}
    >
      {children}
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  className,
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <th
      className={cn("px-3 py-2 font-medium", align === "right" && "text-right", className)}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y">{children}</tbody>;
}

export function Tr({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("hover:bg-accent/40", className)} {...rest}>
      {children}
    </tr>
  );
}

export function Td({
  children,
  align = "left",
  numeric = false,
  className,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  align?: "left" | "right";
  /** Моноширинные цифры — колонки чисел не «пляшут» между строками. */
  numeric?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2",
        align === "right" && "text-right",
        numeric && "tabular-nums",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}
