"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { vehicleTypeLabel } from "@/lib/domain";

interface VehicleLite {
  id: string;
  reg_number: string;
  brand: string;
  vehicle_type: string;
  qr_code: string | null;
}

export function QrStickers({ vehicles }: { vehicles: VehicleLite[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const v of vehicles) {
        const payload = v.qr_code || v.reg_number;
        out[v.id] = await QRCode.toDataURL(payload, { width: 320, margin: 1 });
      }
      if (active) setUrls(out);
    })();
    return () => {
      active = false;
    };
  }, [vehicles]);

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <Button onClick={() => window.print()}>
          <Printer className="size-4" /> Печать наклеек
        </Button>
        <p className="mt-2 text-sm text-muted-foreground">
          Наклейте на борт соответствующей машины. QR кодирует «{"{"}qr_code{"}"}» или гос. номер.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
        {vehicles.map((v) => (
          <div
            key={v.id}
            className="flex flex-col items-center gap-2 rounded-lg border p-4 text-center"
          >
            {urls[v.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[v.id]} alt={v.reg_number} className="w-full max-w-40" />
            ) : (
              <div className="aspect-square w-full max-w-40 animate-pulse rounded bg-muted" />
            )}
            <p className="text-lg font-bold tracking-tight">{v.reg_number}</p>
            <p className="text-xs text-muted-foreground">
              {v.brand} · {vehicleTypeLabel(v.vehicle_type)}
            </p>
          </div>
        ))}
        {vehicles.length === 0 ? (
          <p className="col-span-full text-sm text-muted-foreground">
            Нет активной техники. Добавьте её в справочнике «Техника».
          </p>
        ) : null}
      </div>
    </div>
  );
}
