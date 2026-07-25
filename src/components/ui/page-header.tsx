import type { ReactNode } from "react";

/**
 * Единая шапка раздела: заголовок с иконкой, пояснение под ним и слот действий
 * справа. Рисуется из AppShell/PortalShell — отдельные экраны свои заголовки
 * не собирают, иначе размеры и отступы разъезжаются между разделами.
 */
export function PageHeader({
  title,
  description,
  actions,
  leading,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Кнопка «назад» и иконка экрана. */
  leading?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          {leading}
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
