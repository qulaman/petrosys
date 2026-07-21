"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, CopyPlus, FilePlus2, RotateCw, ScanLine, Truck, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrScanner } from "@/components/field/qr-scanner";
import { SignaturePad } from "@/components/field/signature-pad";
import { VehiclePicker } from "@/components/field/vehicle-picker";
import { useNavProgress } from "@/components/nav-progress";
import { useOutbox } from "@/lib/outbox/use-outbox";
import { uploadSignature } from "@/lib/storage/upload";
import { fmtTime } from "@/lib/format";
import { driverPoolFor } from "@/lib/domain";
import { devError } from "@/lib/dev-log";
import type { TripsScreenData } from "@/lib/data/trips";
import { addLineupVehicle, createLineup, createTrip, deleteTrip, removeLineupVehicle } from "./actions";

const ROUTE_KEY = "qo-trip-route";

interface TripPayload {
  lineup_id: string;
  route_id: string;
  vehicle_id: string;
  driver_id: string;
  driver_signature_url: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
}

function getGeoFast(): Promise<{ lat: number; lng: number } | null> {
  const geo = new Promise<{ lat: number; lng: number } | null>((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 2500, maximumAge: 300000, enableHighAccuracy: false },
    );
  });
  // Обходной таймаут: пока висит браузерный запрос разрешения, timeout из опций
  // не действует и колбэки не вызываются вовсе — рейс не должен ждать вечно.
  const cap = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  return Promise.race([geo, cap]);
}

export function TripsClient({ data }: { data: TripsScreenData }) {
  const { routes, vehicles, drivers, lastDriverByVehicle, recentTrips, lineup, lineupVehicleIds, previous } = data;
  const router = useRouter();
  const pathname = usePathname();

  const [routeId, setRouteId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : localStorage.getItem(ROUTE_KEY),
  );
  const [showQr, setShowQr] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [pendingSig, setPendingSig] = useState<{ vehicle_id: string; driver_id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Защита от дабл-тапа: плитки блокируются на время постановки рейса в очередь,
  // повторный рейс той же машины в коротком окне — только с подтверждением.
  const [enqueueBusy, setEnqueueBusy] = useState(false);
  const lastEnqueueRef = useRef<Map<string, number>>(new Map());

  // Прогрев разрешения геолокации при открытии экрана: промпт появляется в
  // спокойный момент, а не посреди фиксации первого рейса.
  useEffect(() => {
    void getGeoFast();
  }, []);

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

  const onLineSet = useMemo(() => new Set(lineupVehicleIds), [lineupVehicleIds]);
  const onLineVehicles = vehicles.filter((v) => onLineSet.has(v.id));
  const offLineVehicles = vehicles.filter((v) => !onLineSet.has(v.id));

  const nav = useNavProgress();
  function setParams(date: string, shift: string) {
    nav.push(`${pathname}?date=${date}&shift=${shift}`);
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) { toast.error(res.error ?? "Ошибка"); return; }
      if (okMsg) toast.success(okMsg);
      router.refresh();
    });
  }

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
    if (!routeId || !lineup) return;
    const v = vehById.get(vehicleId);
    setEnqueueBusy(true);
    try {
      const geo = await getGeoFast();
      add(
        {
          lineup_id: lineup.id,
          route_id: routeId,
          vehicle_id: vehicleId,
          driver_id: driverId,
          driver_signature_url: signaturePath,
          geo_lat: geo?.lat ?? null,
          geo_lng: geo?.lng ?? null,
        },
        `${v?.reg_number ?? ""} · ${fmtTime(new Date().toISOString())}`,
      );
      lastEnqueueRef.current.set(vehicleId, Date.now());
    } finally {
      setEnqueueBusy(false);
    }
  }

  function recordTrip(vehicleId: string) {
    setError(null);
    if (!routeId || !lineup || enqueueBusy) return;
    const last = lastEnqueueRef.current.get(vehicleId);
    if (last && Date.now() - last < 90_000) {
      const reg = vehById.get(vehicleId)?.reg_number ?? "Машина";
      if (!window.confirm(`${reg} уже записана только что. Записать ещё один рейс?`)) return;
    }
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
    if (!match) {
      setError("QR не распознан. Выберите машину из сетки.");
      return;
    }
    if (!onLineSet.has(match.id)) {
      // Машина ещё не выведена на линию — предлагаем вывести и сразу записать рейс.
      if (!lineup) return;
      if (!window.confirm(`${match.reg_number} не на линии. Вывести на линию и записать рейс?`)) return;
      start(async () => {
        const res = await addLineupVehicle({ lineup_id: lineup.id, vehicle_id: match.id });
        if (!res.ok) { toast.error(res.error ?? "Ошибка"); return; }
        recordTrip(match.id);
        router.refresh();
      });
      return;
    }
    recordTrip(match.id);
  }

  // ---------------------------------------------------------------------------
  // Выбор маршрута в начале смены
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Этап 1 — вывода на линию ещё нет: наследование или чистый лист
  // ---------------------------------------------------------------------------
  if (!lineup) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <ShiftPicker date={data.date} shift={data.shift} onChange={setParams} />

        <p className="text-sm text-muted-foreground">
          Самосвалы на эту смену ещё не выведены на линию. Сформируйте перечень:
        </p>

        {previous ? (
          <Button
            className="h-20 justify-start gap-3 text-left"
            loading={pending}
            onClick={() =>
              act(
                () =>
                  createLineup({
                    work_date: data.date,
                    shift_type: data.shift,
                    inherit_from: previous.id,
                  }),
                "Перечень унаследован",
              )
            }
          >
            <CopyPlus className="size-6 shrink-0" />
            <span>
              <span className="block font-semibold">Наследовать предыдущую смену</span>
              <span className="block text-xs opacity-80">
                {previous.work_date} · {previous.shift_type === "day" ? "день" : "ночь"} · машин: {previous.vehicleCount}
              </span>
            </span>
          </Button>
        ) : null}

        <Button
          variant="outline"
          className="h-20 justify-start gap-3 text-left"
          loading={pending}
          onClick={() =>
            act(
              () =>
                createLineup({
                  work_date: data.date,
                  shift_type: data.shift,
                  inherit_from: null,
                }),
              "Перечень создан",
            )
          }
        >
          <FilePlus2 className="size-6 shrink-0" />
          <span>
            <span className="block font-semibold">С чистого листа</span>
            <span className="block text-xs text-muted-foreground">Вывод машин вручную</span>
          </span>
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Этап 2 — фиксация рейсов по машинам на линии
  // ---------------------------------------------------------------------------
  const hasUnsent = pendingCount > 0;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6">
      <ShiftPicker date={data.date} shift={data.shift} onChange={setParams} />

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

      <VehiclePicker
        vehicles={onLineVehicles}
        large
        sub="brand"
        stickyFilters
        disabled={enqueueBusy}
        onSelect={(v) => recordTrip(v.id)}
        emptyText="Самосвалы не найдены"
        noVehiclesText="На линии пока нет машин — выведите их ниже."
      />

      {/* Управление линией: вывести/снять машину в течение смены */}
      <div className="flex flex-col gap-2">
        <Button variant="secondary" className="h-12" onClick={() => setManageOpen((v) => !v)}>
          <Truck className="size-5" /> На линии: {onLineVehicles.length} · Вывести машину
        </Button>
        {manageOpen ? (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-1.5">
              <Label>Не на линии — нажмите, чтобы вывести</Label>
              <VehiclePicker
                vehicles={offLineVehicles}
                sub="brand"
                disabled={pending}
                noVehiclesText="Все самосвалы уже на линии"
                onSelect={(v) =>
                  act(() => addLineupVehicle({ lineup_id: lineup.id, vehicle_id: v.id }), `${v.reg_number} на линии`)
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>На линии — нажмите, чтобы снять (пока нет рейсов)</Label>
              <VehiclePicker
                vehicles={onLineVehicles}
                sub="brand"
                disabled={pending}
                noVehiclesText="На линии нет машин"
                tileTrailing={<X className="size-4 shrink-0 text-destructive" />}
                onSelect={(v) =>
                  act(() => removeLineupVehicle({ lineup_id: lineup.id, vehicle_id: v.id }), `${v.reg_number} снята с линии`)
                }
              />
            </div>
          </div>
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
            <EmptyState icon={Truck} title="Рейсов пока нет" description="Отсканируйте QR машины или выберите её выше — рейс запишется в два касания." className="border-0 p-6" />
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

function ShiftPicker({
  date,
  shift,
  onChange,
}: {
  date: string;
  shift: "day" | "night";
  onChange: (date: string, shift: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tr-date">Дата</Label>
        <Input id="tr-date" type="date" value={date} onChange={(e) => onChange(e.target.value, shift)} className="h-12" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Смена</Label>
        <div className="grid grid-cols-2 gap-1">
          <Button type="button" className="h-12" variant={shift === "day" ? "default" : "outline"} onClick={() => onChange(date, "day")}>День</Button>
          <Button type="button" className="h-12" variant={shift === "night" ? "default" : "outline"} onClick={() => onChange(date, "night")}>Ночь</Button>
        </div>
      </div>
    </div>
  );
}
