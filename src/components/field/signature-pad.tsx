"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";
import { Button } from "@/components/ui/button";
import { FullscreenSheet, FullscreenSheetClose } from "@/components/field/fullscreen-sheet";

/**
 * Полноэкранная подпись пальцем. Сверху крупно ФИО подписанта, снизу — крупные
 * кнопки Очистить/Готово. onDone возвращает SVG-разметку подписи (вектор штрихов:
 * ~2 КБ против ~100 КБ у PNG с retina-канваса — критично для объёма хранилища).
 */
export function SignaturePad({
  signerName,
  onDone,
  onCancel,
}: {
  signerName: string;
  onDone: (svg: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pad = new SignaturePadLib(canvas, {
      penColor: "#111",
      backgroundColor: "#fff",
    });
    padRef.current = pad;

    // Размер холста в CSS-пикселях на момент последней настройки. Нужен, чтобы
    // пересчитать координаты уже нарисованных штрихов при смене размера.
    let cssW = 0;
    let cssH = 0;

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      // Мобильные браузеры шлют resize при показе/скрытии адресной строки —
      // если размер тот же, трогать холст нельзя.
      if (width === cssW && height === cssH) return;

      // Поворот телефона раньше стирал подпись: canvas.width сбрасывает холст,
      // а старый код после этого ещё и звал pad.clear(). Сохраняем штрихи и
      // переносим их в новые пропорции.
      const strokes = pad.toData();
      const scaleX = cssW ? width / cssW : 1;
      const scaleY = cssH ? height / cssH : 1;

      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      cssW = width;
      cssH = height;

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
    resize();

    const onEnd = () => setEmpty(pad.isEmpty());
    pad.addEventListener("endStroke", onEnd);
    window.addEventListener("resize", resize);
    // Поворот экрана на части устройств приходит только этим событием.
    window.addEventListener("orientationchange", resize);

    return () => {
      pad.removeEventListener("endStroke", onEnd);
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
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
      {/* Холст всегда белый с чёрным штрихом — независимо от темы: подпись
          уходит в документы и должна выглядеть одинаково. */}
      <div className="mx-4 flex-1 overflow-hidden rounded-lg border bg-white">
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
