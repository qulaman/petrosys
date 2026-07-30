"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

/**
 * Полноэкранный модальный слой полевых экранов (подпись, сканер QR).
 *
 * Раньше это были обычные `fixed inset-0`-контейнеры: визуально они закрывали
 * экран, но фокус оставался на форме под ними — с клавиатуры можно было уйти из
 * подписи и нажать что угодно на фоне, а Escape ничего не закрывал. Base UI
 * даёт то, что руками не написано: `aria-modal`, перенос фокуса внутрь и его
 * возврат на кнопку-триггер при закрытии, блокировку фона и Escape.
 *
 * Анимаций входа сознательно нет: `SignaturePad` считает размер холста сразу
 * после монтирования, и любой transform дал бы неверные пропорции подписи.
 */
export function FullscreenSheet({
  title,
  onClose,
  children,
}: {
  /** Заголовок сверху — он же доступное имя диалога. */
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      // Случайный тап мимо кнопок не должен снимать подпись или гасить сканер:
      // выйти можно только «Отменой» или Escape.
      disablePointerDismissal
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup className="fixed inset-0 z-50 flex flex-col bg-background outline-none">
          <DialogPrimitive.Title className="p-4 text-center text-lg font-semibold">
            {title}
          </DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Кнопка закрытия внутри слоя. Именно `Dialog.Close`, а не свой onClick:
 * в модальном режиме экранным читалкам на телефоне нужен явный выход из слоя.
 */
export const FullscreenSheetClose = DialogPrimitive.Close;
