"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, RotateCw, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrScanner } from "@/components/field/qr-scanner";
import { SignaturePad } from "@/components/field/signature-pad";
import { useOutbox } from "@/lib/outbox/use-outbox";
import { uploadSignature } from "@/lib/storage/upload";
import { fmtTime } from "@/lib/format";
import { driverPoolFor } from "@/lib/domain";
import { devError } from "@/lib/dev-log";
import type { TripsScreenData } from "@/lib/data/trips";
import { createTrip, deleteTrip } from "./actions";

const ROUTE_KEY = "qo-trip-route";

interface TripPayload {
  route_id: string;
  vehicle_id: string;
  driver_id: string;
  driver_signature_url: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
}

function getGeoFast(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 2500, maximumAge: 300000, enableHighAccuracy: false },
    );
  });
}

export function TripsClient({ data }: { data: TripsScreenData }) {
  const { routes, vehicles, drivers, lastDriverByVehicle, recentTrips } = data;
  const router = useRouter();

  const [routeId, setRouteId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(ROUTE_KEY),
  );
  const [search, setSearch] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [pendingSig, setPendingSig] = useState<{ vehicle_id: string; driver_id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback((p: TripPayload) => createTrip(p), []);
  const onSuccess = useCallback(() => router.refresh(), [router]);
  const { entries, pendingCount, add, remove, flush } = useOutbox<TripPayload>(
    "trip",
    submit,
    onSuccess,
  );

  const route = routes.find((r) => r.id === routeId) ?? null;
  const vehById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const drvById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter(
      (v) => v.reg_number.toLowerCase().includes(q) || v.brand.toLowerCase().includes(q),
    );
  }, [vehicles, search]);

  function chooseRoute(id: string) {
    setRouteId(id);
    localStorage.setItem(ROUTE_KEY, id);
  }

  function driverForVehicle(vehicleId: string): string | null {
    const last = lastDriverByVehicle[vehicleId];
    if (last) return last;
    const pool = driverPoolFor(vehById.get(vehicleId), drivers);
    return pool[0]?.id ?? drivers[0]?.id ?? null;
  }

  async function enqueueTrip(vehicleId: string, driverId: string, signaturePath: string | null) {
    if (!routeId) return;
    const v = vehById.get(vehicleId);
    const geo = await getGeoFast();
    add(
      {
        route_id: routeId,
        vehicle_id: vehicleId,
        driver_id: driverId,
        driver_signature_url: signaturePath,
        geo_lat: geo?.lat ?? null,
        geo_lng: geo?.lng ?? null,
      },
      `${v?.reg_number ?? ""} · ${fmtTime(new Date().toISOString())}`,
    );
  }

  function recordTrip(vehicleId: string) {
    setError(null);
    if (!routeId) return;
    const driverId = driverForVehicle(vehicleId);
    if (!driverId) {
      setError("Для машины нет активного водителя");
      return;
    }
    if (route?.require_signature) {
      setPendingSig({ vehicle_id: vehicleId, driver_id: driverId });
      return;
    }
    void enqueueTrip(vehicleId, driverId, null);
  }

  function onQrDetected(text: string) {
    setShowQr(false);
    const t = text.trim();
    const match =
      vehicles.find((v) => v.qr_code === t) ??
      vehicles.find((v) => v.reg_number.replace(/\s/g, "") === t.replace(/\s/g, ""));
    if (match) recordTrip(match.id);
    else setError("QR не распознан. Выберите машину из сетки.");
  }

  // Выбор маршрута в начале смены
  if (!route) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-3">
        <p className="text-sm text-muted-foreground">Выберите маршрут на смену:</p>
        {routes.map((r) => (
          <Button key={r.id} className="h-16 text-lg" variant="outline" onClick={() => chooseRoute(r.id)}>
            {r.name}
          </Button>
        ))}
        {routes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Маршрутов нет. Добавьте их в справочнике «Маршруты».
          </p>
        ) : null}
      </div>
    );
  }

  const hasUnsent = pendingCount > 0;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <p className="text-xs text-muted-foreground">Маршрут смены</p>
          <p className="font-semibold">{route.name}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setRouteId(null)}>
          Сменить
        </Button>
      </div>

      {hasUnsent ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
          <AlertTriangle className="size-4 text-amber-600" />
          Не отправлено: {pendingCount}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void flush()}>
            <RotateCw className="size-4" /> Повторить
          </Button>
        </div>
      ) : null}

      <Button className="h-20 text-xl" onClick={() => setShowQr(true)}>
        <ScanLine className="size-7" /> Сканировать QR
      </Button>

      <Input
        placeholder="Гос. номер или марка"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-12"
      />

      <div className="grid grid-cols-2 gap-2">
        {filtered.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => recordTrip(v.id)}
            className="flex min-h-20 flex-col items-center justify-center rounded-lg border p-3 text-center active:bg-accent"
          >
            <span className="text-2xl font-bold tracking-tight">{v.reg_number}</span>
            <span className="text-xs text-muted-foreground">{v.brand}</span>
          </button>
        ))}
        {filtered.length === 0 ? (
          <p className="col-span-2 text-sm text-muted-foreground">Самосвалы не найдены</p>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* Лента: неотправленные + недавние подтверждённые */}
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium">Последние рейсы</p>
        <div className="flex flex-col divide-y rounded-lg border">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-2 p-3 text-sm">
              <RotateCw className={`size-4 ${e.status === "error" ? "text-destructive" : "text-amber-600"}`} />
              <span className="flex-1">{e.label}</span>
              <span className="text-xs text-muted-foreground">
                {e.status === "error" ? "не отправлено" : "отправляется…"}
              </span>
              {e.status === "error" ? (
                <button onClick={() => remove(e.id)} aria-label="Убрать">
                  <X className="size-4 text-muted-foreground" />
                </button>
              ) : null}
            </div>
          ))}
          {recentTrips.map((t) => {
            const canUndo = Date.now() - new Date(t.at).getTime() < 5 * 60 * 1000;
            return (
              <div key={t.id} className="flex items-center gap-2 p-3 text-sm">
                <Check className="size-4 text-green-600" />
                <span className="flex-1">
                  {vehById.get(t.vehicle_id)?.reg_number ?? "—"}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {drvById.get(t.driver_id)?.full_name ?? ""}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{fmtTime(t.at)}</span>
                {canUndo ? (
                  <button
                    className="text-xs text-destructive underline"
                    onClick={async () => {
                      const res = await deleteTrip(t.id);
                      if (res.ok) { toast.success("Рейс отменён"); router.refresh(); }
                      else { devError("deleteTrip", res.error); toast.error(res.error ?? "Ошибка"); }
                    }}
                  >
                    Отменить
                  </button>
                ) : null}
              </div>
            );
          })}
          {entries.length === 0 && recentTrips.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Рейсов пока нет</p>
          ) : null}
        </div>
      </section>

      {showQr ? (
        <QrScanner onDetected={onQrDetected} onCancel={() => setShowQr(false)} />
      ) : null}

      {pendingSig ? (
        <SignaturePad
          signerName={drvById.get(pendingSig.driver_id)?.full_name ?? "Водитель"}
          onDone={async (dataUrl) => {
            const sig = pendingSig;
            setPendingSig(null);
            try {
              const path = await uploadSignature(data.orgId, dataUrl);
              await enqueueTrip(sig.vehicle_id, sig.driver_id, path);
            } catch (err) {
              devError("trip-signature", err);
              setError("Не удалось загрузить подпись");
            }
          }}
          onCancel={() => setPendingSig(null)}
        />
      ) : null}
    </div>
  );
}
