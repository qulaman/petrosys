"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

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

  useEffect(() => {
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
            onDetected(decoded);
          },
          () => {},
        );
        if (cancelled) {
          await scanner.stop().catch(() => {});
        }
      } catch {
        setError("Камера недоступна. Выберите машину из списка.");
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) s.stop().then(() => s.clear()).catch(() => {});
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="p-4 text-center text-lg font-semibold">
        Наведите на QR на борту
      </div>
      <div className="mx-4 flex-1 overflow-hidden rounded-lg border">
        <div id={containerId} className="h-full w-full" />
        {error ? (
          <p className="p-4 text-center text-sm text-destructive">{error}</p>
        ) : null}
      </div>
      <div className="p-4">
        <Button variant="outline" className="h-14 w-full text-base" onClick={onCancel} type="button">
          Отмена
        </Button>
      </div>
    </div>
  );
}
