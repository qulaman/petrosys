import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Подпись группы контролов: выглядит как `<Label>`, но не является `<label>`.
 *
 * У группы кнопок («Источник топлива», «Смена»), у кейпада и у списка карточек
 * нет одного контрола, к которому можно привязаться через `htmlFor`, а `<label>`
 * без привязки экранная читалка не связывает ни с чем — группа зачитывалась как
 * безымянная россыпь кнопок. Ставится в паре с `role="group"` и
 * `aria-labelledby` на контейнере:
 *
 * ```tsx
 * <section role="group" aria-labelledby="shift-label">
 *   <GroupLabel id="shift-label">Смена</GroupLabel>
 *   …
 * </section>
 * ```
 *
 * Для одиночного поля это не нужно — там обычный `<Label htmlFor>`.
 */
export function GroupLabel({
  id,
  className,
  children,
}: {
  /** На него ссылается `aria-labelledby` контейнера. */
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      id={id}
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none",
        className,
      )}
    >
      {children}
    </span>
  );
}
