"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";
import { Button } from "@/components/ui/button";

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

    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      pad.clear();
      setEmpty(true);
    };
    resize();

    const onEnd = () => setEmpty(pad.isEmpty());
    pad.addEventListener("endStroke", onEnd);
    window.addEventListener("resize", resize);

    return () => {
      pad.removeEventListener("endStroke", onEnd);
      window.removeEventListener("resize", resize);
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
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="p-4 text-center">
        <p className="text-lg font-semibold">{signerName}, распишитесь</p>
      </div>

      <div className="mx-4 flex-1 overflow-hidden rounded-lg border bg-white">
        <canvas ref={canvasRef} className="h-full w-full touch-none" />
      </div>

      <div className="grid grid-cols-2 gap-3 p-4">
        <Button variant="outline" className="h-14 text-base" onClick={clear} type="button">
          Очистить
        </Button>
        <Button className="h-14 text-base" onClick={done} disabled={empty} type="button">
          Готово
        </Button>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="pb-4 text-sm text-muted-foreground underline"
      >
        Отмена
      </button>
    </div>
  );
}
