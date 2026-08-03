"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FullscreenSheet, FullscreenSheetClose } from "@/components/field/fullscreen-sheet";
import { ru } from "@/lib/i18n/ru";

/**
 * Полноэкранный сканер QR (html5-qrcode). onDetected вызывается один раз при
 * первом распознавании, после чего камера останавливается.
 */
export function QrScanner({
  onDetected,
  onCancel,
}: {
  onDetected: (text: string) => void;
  onCancel: () => void;
}) {
  const containerId = "qr-reader";
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(
    null,
  );
  const handledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Контейнер камеры держим в состоянии, а не ищем по id из эффекта: содержимое
   * FullscreenSheet приезжает через портал base-ui на пару коммитов позже, и
   * `new Html5Qrcode(containerId)` не находил элемент, падал, а catch ниже
   * превращал это в «камера недоступна» на каждом открытии сканера.
   */
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  // Колбэк через ref: в форме выдачи он объявлен телом компонента и меняет
  // идентичность на каждый рендер — в зависимостях эффекта это перезапускало
  // камеру.
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  });

  useEffect(() => {
    if (!host) return;
    let cancelled = false;

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode(containerId, { verbose: false });
        scannerRef.current = scanner as unknown as {
          stop: () => Promise<void>;
          clear: () => void;
        };
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            if (handledRef.current) return;
            handledRef.current = true;
            scanner.stop().then(() => scanner.clear()).catch(() => {});
            onDetectedRef.current(decoded);
          },
          () => {},
        );
        if (cancelled) {
          await scanner.stop().catch(() => {});
        }
      } catch {
        setError(ru.errors.cameraUnavailable);
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) s.stop().then(() => s.clear()).catch(() => {});
    };
  }, [host]);

  return (
    <FullscreenSheet title="Наведите на QR на борту" onClose={onCancel}>
      <div className="mx-4 flex-1 overflow-hidden rounded-lg border">
        <div id={containerId} ref={setHost} className="h-full w-full" />
        {error ? (
          <p className="p-4 text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="p-4">
        <FullscreenSheetClose
          render={<Button variant="outline" className="h-14 w-full text-base" />}
        >
          Отмена
        </FullscreenSheetClose>
      </div>
    </FullscreenSheet>
  );
}
