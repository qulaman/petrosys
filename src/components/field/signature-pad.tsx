"use client";

import { useLayoutEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";
import { Button } from "@/components/ui/button";
import { FullscreenSheet, FullscreenSheetClose } from "@/components/field/fullscreen-sheet";
import { devLog } from "@/lib/dev-log";

/**
 * Полноэкранная подпись пальцем. Сверху крупно ФИО подписанта, снизу — крупные
 * кнопки Очистить/Готово. onDone возвращает SVG-разметку подписи (вектор штрихов:
 * ~2 КБ против ~100 КБ у PNG с retina-канваса — критично для объёма хранилища).
 */
export function SignaturePad({
  signerName,
  subject,
  onDone,
  onCancel,
}: {
  signerName: string;
  /**
   * Предмет подписи — что именно человек подтверждает («225 л · 852 AOD»).
   * Подпись юридически значима, а телефон в этот момент в руках у водителя:
   * без этой строки он расписывался, не видя ни литров, ни машины.
   */
  subject?: string;
  onDone: (svg: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [empty, setEmpty] = useState(true);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;

    const pad = new SignaturePadLib(canvas, {
      penColor: "#111",
      backgroundColor: "#fff",
    });
    padRef.current = pad;

    // Размер холста в CSS-пикселях на момент последней настройки битмапа. Нужен,
    // чтобы пересчитать координаты уже нарисованных штрихов при смене размера.
    let cssW = 0;
    let cssH = 0;

    /**
     * Привести битмап холста к его CSS-боксу. Без этого подпись не видна:
     * signature_pad кладёт точку в CSS-координатах относительно холста
     * (clientX - rect.left) и рисует их в битмап как есть. Если битмап остался
     * дефолтным 300×150, а бокс на телефоне ~360×430, всё ниже 150-го пикселя
     * уходит за пределы битмапа — палец водит, а на экране пусто.
     */
    const fit = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      // Наблюдатель шлёт события и когда бокс не менялся (перерисовка слоя) —
      // если размер тот же, трогать холст нельзя: canvas.width стирает подпись.
      if (width === cssW && height === cssH) return;

      // Поворот телефона раньше стирал подпись: canvas.width сбрасывает холст,
      // а старый код после этого ещё и звал pad.clear(). Сохраняем штрихи и
      // переносим их в новые пропорции.
      const strokes = pad.toData();
      const scaleX = cssW ? width / cssW : 1;
      const scaleY = cssH ? height / cssH : 1;

      // Плотность ограничена двойкой: при DPR 3–4 битмап уходит за 1400×1700,
      // рисование на телефоне начинает лагать, а подпись всё равно уезжает в
      // документы вектором — на её качество плотность не влияет.
      const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      cssW = width;
      cssH = height;
      devLog("signature-pad", "холст", {
        css: `${Math.round(width)}×${Math.round(height)}`,
        bitmap: `${canvas.width}×${canvas.height}`,
      });

      if (strokes.length) {
        pad.fromData(
          strokes.map((g) => ({
            ...g,
            points: g.points.map((p) => ({ ...p, x: p.x * scaleX, y: p.y * scaleY })),
          })),
        );
      } else {
        pad.clear();
      }
      setEmpty(pad.isEmpty());
    };

    // ResizeObserver вместо одноразового замера и слушателей window: холст живёт
    // внутри портала base-ui (FullscreenSheet) и монтируется на пару коммитов
    // позже формы. Одиночный замер мог прийтись на момент, когда бокса ещё нет,
    // и молча отваливался по `if (!width || !height)` — битмап навсегда
    // оставался 300×150. Наблюдатель отдаёт размер сразу при observe() и на
    // каждое изменение: поворот, клавиатура, адресная строка — своих слушателей
    // на resize/orientationchange больше не нужно.
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    // Страховка перед штрихом: если размер всё же разошёлся (случай, которого
    // наблюдатель не увидел), пересчитываем ДО того, как signature_pad начнёт
    // писать. Именно capture и именно на обёртке: свой слушатель на холсте
    // библиотека вешает в конструкторе, то есть раньше нашего.
    box.addEventListener("pointerdown", fit, true);

    const onEnd = () => setEmpty(pad.isEmpty());
    pad.addEventListener("endStroke", onEnd);

    return () => {
      ro.disconnect();
      box.removeEventListener("pointerdown", fit, true);
      pad.removeEventListener("endStroke", onEnd);
      pad.off();
    };
  }, []);

  function clear() {
    padRef.current?.clear();
    setEmpty(true);
  }

  function done() {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) return;
    onDone(pad.toSVG({ includeBackgroundColor: true }));
  }

  return (
    <FullscreenSheet title={`${signerName}, распишитесь`} onClose={onCancel}>
      {subject ? (
        <p className="mx-4 mb-2 rounded-lg bg-muted px-3 py-2 text-center text-lg font-bold tabular-nums">
          {subject}
        </p>
      ) : null}
      {/* Холст всегда белый с чёрным штрихом — независимо от темы: подпись
          уходит в документы и должна выглядеть одинаково. */}
      <div ref={boxRef} className="mx-4 flex-1 overflow-hidden rounded-lg border bg-white">
        <canvas
          ref={canvasRef}
          aria-label="Поле для подписи пальцем"
          className="h-full w-full touch-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 p-4">
        <Button variant="outline" className="h-14 text-base" onClick={clear} type="button">
          Очистить
        </Button>
        <Button className="h-14 text-base" onClick={done} disabled={empty} type="button">
          Готово
        </Button>
      </div>
      <FullscreenSheetClose
        render={
          <Button
            variant="ghost"
            className="mx-auto mb-4 min-h-11 text-sm font-normal text-muted-foreground underline"
          />
        }
      >
        Отмена
      </FullscreenSheetClose>
    </FullscreenSheet>
  );
}
