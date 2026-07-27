import { cn } from "@/lib/utils";

/**
 * Секция дашборда: заголовок, пояснение и слот действий справа.
 * Вкладки рисовали заголовки вручную и разошлись — где-то пояснение шло серым
 * хвостом в самом заголовке, где-то мелким текстом под графиком.
 */
export function Section({
  title,
  hint,
  description,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  /** Короткий серый хвост в строке заголовка: единицы, медиана, подсказка про клик. */
  hint?: React.ReactNode;
  /** Пояснение под заголовком — то, что раньше висело мелким текстом под графиком. */
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">
            {title}
            {hint ? <span className="font-normal text-muted-foreground"> {hint}</span> : null}
          </h3>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Рамка вокруг содержимого секции — общий вид карточек графиков и списков. */
export function Panel({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border bg-card", padded && "p-4", className)}>{children}</div>
  );
}
