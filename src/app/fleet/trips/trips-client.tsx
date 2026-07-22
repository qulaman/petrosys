"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, CopyPlus, FilePlus2, RotateCw, ScanLine, Trash2, Truck, X } from "lucide-react";
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
import { addLineupVehicle, closeTripJournal, createLineup, createTrip, deleteShiftTrips, deleteTrip, deleteTripJournal, deleteTrips, removeLineupVehicle, reopenTripJournal } from "./actions";

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
  const { routes, vehicles, drivers, lastDriverByVehicle, lineup, lineupVehicleIds, previous, shiftStats, shiftTrips, canReopen } = data;
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
  // Двухэтапный ввод: экран проверки карточки смены и подпись мастера на закрытии.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [signClose, setSignClose] = useState(false);
  // Подтверждение повторного рейса ПРЯМО в плитке машины (не тост): сама плитка
  // превращается в вопрос; сбрасывается кнопкой, другим тапом или через 6 секунд.
  const [confirmRepeat, setConfirmRepeat] = useState<{ vehicleId: string; label: string } | null>(null);
  useEffect(() => {
    if (!confirmRepeat) return;
    const t = setTimeout(() => setConfirmRepeat(null), 6000);
    return () => clearTimeout(t);
  }, [confirmRepeat]);
  // Пакетное удаление в ленте: режим выбора + отмеченные записи.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAllTrips, setShowAllTrips] = useState(false);
  // Лента = рейсы ТЕКУЩЕЙ смены, свежие сверху (старые дни — в журнале рейсов).
  const shiftFeed = useMemo(() => [...data.shiftTrips].reverse(), [data.shiftTrips]);

  // Живое «сейчас» для мини-дашборда смены (темп, простой машин) — тикает раз в 30 с.
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    // Первый тик — асинхронно (rAF): синхронный setState в теле эффекта запрещён линтом.
    const tick = () => setNowTs(Date.now());
    const raf = requestAnimationFrame(tick);
    const t = setInterval(tick, 30_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);

  // Сводка смены для шапки-дашборда.
  const shiftInfo = useMemo(() => {
    const total = data.shiftTrips.length;
    const activeVehicles = new Set(data.shiftTrips.map((t) => t.vehicle_id)).size;
    const first = data.shiftTrips[0]?.at;
    const hours = first && nowTs ? Math.max((nowTs - Date.parse(first)) / 3_600_000, 0.25) : null;
    return {
      total,
      activeVehicles,
      perHour: hours && total ? Math.round((total / hours) * 10) / 10 : null,
    };
  }, [data.shiftTrips, nowTs]);

  const tripsByVehicle = useMemo(() => {
    const m = new Map<string, { count: number; lastId: string }>();
    for (const t of data.shiftTrips) {
      const cur = m.get(t.vehicle_id);
      m.set(t.vehicle_id, { count: (cur?.count ?? 0) + 1, lastId: t.id });
    }
    return m;
  }, [data.shiftTrips]);

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
  // Сортировка «давно без рейса — сверху» для массового ввода (по умолчанию алфавит).
  const [sortIdleFirst, setSortIdleFirst] = useState(false);
  const onLineVehicles = useMemo(() => {
    const list = vehicles.filter((v) => onLineSet.has(v.id));
    if (!sortIdleFirst) return list;
    return [...list].sort((a, b) => {
      const la = shiftStats[a.id]?.lastAt ?? "";
      const lb = shiftStats[b.id]?.lastAt ?? "";
      return la === lb ? a.reg_number.localeCompare(b.reg_number, "ru") : la < lb ? -1 : 1;
    });
  }, [vehicles, onLineSet, sortIdleFirst, shiftStats]);
  const offLineVehicles = vehicles.filter((v) => !onLineSet.has(v.id));

  // Машины на линии, у которых давно не было рейса (> 45 мин) — сигнал мастеру.
  const idleMinutes = (vehicleId: string): number | null => {
    const s = shiftStats[vehicleId];
    if (!s || !nowTs) return null;
    return Math.round((nowTs - Date.parse(s.lastAt)) / 60_000);
  };
  const staleVehicles = useMemo(() => {
    if (!nowTs) return [];
    return vehicles
      .filter((v) => onLineSet.has(v.id) && shiftStats[v.id])
      .map((v) => ({ v, idle: Math.round((nowTs - Date.parse(shiftStats[v.id].lastAt)) / 60_000) }))
      .filter((x) => x.idle > 45)
      .sort((a, b) => b.idle - a.idle);
  }, [vehicles, onLineSet, shiftStats, nowTs]);

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

  function proceedRecord(vehicleId: string) {
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

  function recordTrip(vehicleId: string) {
    setError(null);
    if (!routeId || !lineup || enqueueBusy) return;
    const last = lastEnqueueRef.current.get(vehicleId);
    if (last && Date.now() - last < 90_000) {
      // Подтверждение прямо в плитке машины — взгляд не уходит с места тапа.
      const secAgo = Math.max(1, Math.round((Date.now() - last) / 1000));
      setConfirmRepeat({ vehicleId, label: `Записана ${secAgo} сек назад. Ещё рейс?` });
      return;
    }
    setConfirmRepeat(null);
    proceedRecord(vehicleId);
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
      // Машина ещё не выведена на линию — предлагаем тостом (без браузерного confirm).
      if (!lineup) return;
      const lineupId = lineup.id;
      toast(`${match.reg_number} не на линии`, {
        description: "Вывести на линию и записать рейс?",
        action: {
          label: "Вывести и записать",
          onClick: () =>
            start(async () => {
              const res = await addLineupVehicle({ lineup_id: lineupId, vehicle_id: match.id });
              if (!res.ok) { toast.error(res.error ?? "Ошибка"); return; }
              recordTrip(match.id);
              router.refresh();
            }),
        },
        cancel: { label: "Отмена", onClick: () => {} },
        duration: 8000,
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
  // Карточка закрыта: read-only сводка, ввод заблокирован
  // ---------------------------------------------------------------------------
  if (lineup.status === "closed") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <ShiftPicker date={data.date} shift={data.shift} onChange={setParams} />
        <div className="flex items-center gap-2 rounded-lg border border-green-600 bg-green-600/10 p-3">
          <Check className="size-5 text-green-600" />
          <div className="flex-1">
            <p className="font-semibold">Смена закрыта мастером</p>
            <p className="text-xs text-muted-foreground">
              Рейсов подтверждено: {shiftTrips.length} · записи в расчётах
            </p>
          </div>
          {canReopen ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => act(() => reopenTripJournal(lineup.id), "Карточка переоткрыта")}
            >
              Переоткрыть
            </Button>
          ) : null}
        </div>
        <ShiftSummary
          tripsByVehicle={tripsByVehicle}
          vehicles={vehicles}
          lineupVehicleIds={lineupVehicleIds}
        />
        {!canReopen ? (
          <p className="text-xs text-muted-foreground">
            Изменения после закрытия — только через офис (переоткрытие карточки).
          </p>
        ) : null}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Этап 2 — фиксация рейсов по машинам на линии (карточка открыта, черновик)
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

      {/* Мини-дашборд карточки смены: цифры, сигналы и ВСЕ действия карточки — наверху. */}
      <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">Карточка смены · черновик</p>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant={reviewOpen ? "default" : "outline"}
              onClick={() => setReviewOpen((v) => !v)}
            >
              <Check className="size-4" /> Проверить и закрыть
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8 text-destructive"
              aria-label="Удалить карточку смены"
              disabled={pending}
              onClick={() =>
                toast("Удалить карточку смены целиком?", {
                  description: `Будут удалены все рейсы (${shiftTrips.length}) и перечень машин. Смену можно будет создать заново.`,
                  action: {
                    label: "Удалить карточку",
                    onClick: () => act(() => deleteTripJournal(lineup.id), "Карточка смены удалена"),
                  },
                  cancel: { label: "Отмена", onClick: () => {} },
                  duration: 8000,
                })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border bg-background p-2 text-center">
            <p className="text-2xl font-bold tabular-nums">{shiftInfo.total}</p>
            <p className="text-xs text-muted-foreground">рейсов</p>
          </div>
          <div className="rounded-md border bg-background p-2 text-center">
            <p className="text-2xl font-bold tabular-nums">
              {shiftInfo.activeVehicles}<span className="text-base font-medium text-muted-foreground">/{onLineVehicles.length}</span>
            </p>
            <p className="text-xs text-muted-foreground">машин ездило</p>
          </div>
          <div className="rounded-md border bg-background p-2 text-center">
            <p className="text-2xl font-bold tabular-nums">{shiftInfo.perHour ?? "—"}</p>
            <p className="text-xs text-muted-foreground">рейсов/час</p>
          </div>
        </div>

        {staleVehicles.length ? (
          <div className="flex items-start gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p>
              Давно без рейса:{" "}
              {staleVehicles.slice(0, 4).map((x, i) => (
                <span key={x.v.id}>
                  {i > 0 ? ", " : ""}
                  <span className="font-semibold">{x.v.reg_number}</span>{" "}
                  <span className="text-muted-foreground">({x.idle} мин)</span>
                </span>
              ))}
              {staleVehicles.length > 4 ? ` и ещё ${staleVehicles.length - 4}` : ""}
            </p>
          </div>
        ) : null}
      </div>

      {reviewOpen ? (
        <section className="flex flex-col gap-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Проверка карточки: рейсы по машинам</p>
          <ShiftSummary
            tripsByVehicle={tripsByVehicle}
            vehicles={vehicles}
            lineupVehicleIds={lineupVehicleIds}
            editable
            busy={pending || enqueueBusy}
            onPlus={(vid) => proceedRecord(vid)}
            onMinus={async (lastId) => {
              const res = await deleteTrip(lastId);
              if (res.ok) { toast.success("Рейс убран"); router.refresh(); }
              else toast.error(res.error ?? "Ошибка");
            }}
          />
          <p className="text-xs text-muted-foreground">
            После подписи рейсы попадут в расчёты и АВР; правки — только через офис.
          </p>
          <Button
            className="h-12"
            disabled={pending || shiftTrips.length === 0}
            onClick={() => setSignClose(true)}
          >
            Подписать и закрыть смену ({shiftTrips.length} рейсов)
          </Button>
        </section>
      ) : null}

      <Button className="h-20 text-xl" onClick={() => setShowQr(true)}>
        <ScanLine className="size-7" /> Сканировать QR
      </Button>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Тап по машине = +1 рейс</p>
        <Button
          variant={sortIdleFirst ? "default" : "outline"}
          size="sm"
          onClick={() => setSortIdleFirst((v) => !v)}
        >
          Давно без рейса — сверху
        </Button>
      </div>
      <VehiclePicker
        vehicles={onLineVehicles}
        large
        sub="brand"
        stickyFilters
        disabled={enqueueBusy}
        onSelect={(v) => recordTrip(v.id)}
        emptyText="Самосвалы не найдены"
        noVehiclesText="На линии пока нет машин — выведите их ниже."
        tileConfirm={(v) => {
          if (confirmRepeat?.vehicleId !== v.id) return null;
          return (
            <div className="flex w-full flex-col gap-1.5">
              <p className="text-sm font-semibold leading-tight">
                {v.reg_number} <span className="font-normal text-muted-foreground">{confirmRepeat.label}</span>
              </p>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-9 flex-1"
                  onClick={() => { setConfirmRepeat(null); proceedRecord(v.id); }}
                >
                  Записать
                </Button>
                <Button size="sm" variant="outline" className="h-9 flex-1" onClick={() => setConfirmRepeat(null)}>
                  Отмена
                </Button>
              </div>
            </div>
          );
        }}
        tileInfo={(v) => {
          const s = shiftStats[v.id];
          const idle = idleMinutes(v.id);
          const stale = idle != null && idle > 45;
          return (
            <span className="ml-2 flex shrink-0 flex-col items-end">
              <span className={`rounded-full px-2 py-0.5 text-sm font-bold tabular-nums ${s ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {s?.count ?? 0}
              </span>
              <span className={`mt-0.5 text-xs tabular-nums ${stale ? "font-semibold text-amber-600" : "text-muted-foreground"}`}>
                {s ? (stale ? `${idle} мин назад` : fmtTime(s.lastAt)) : "—"}
              </span>
            </span>
          );
        }}
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

      {/* Лента: неотправленные + рейсы текущей смены */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Рейсы смены ({shiftTrips.length})</p>
          <Button
            variant={selectMode ? "default" : "ghost"}
            size="sm"
            onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
          >
            {selectMode ? "Готово" : "Выбрать"}
          </Button>
        </div>
        {selectMode ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={pending || selected.size === 0}
              onClick={() =>
                act(async () => {
                  const res = await deleteTrips([...selected]);
                  if (res.ok) { setSelected(new Set()); if (res.error) toast.info(res.error); }
                  return res;
                }, "Выбранные рейсы удалены")
              }
            >
              <Trash2 className="size-4" /> Удалить выбранные ({selected.size})
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending || shiftTrips.length === 0}
              onClick={() =>
                toast(`Удалить все рейсы смены (${shiftTrips.length})?`, {
                  description: "Карточка останется, машины на линии сохранятся.",
                  action: {
                    label: "Удалить все",
                    onClick: () =>
                      act(async () => {
                        const res = await deleteShiftTrips(lineup.id);
                        if (res.ok) { setSelected(new Set()); setSelectMode(false); if (res.error) toast.info(res.error); }
                        return res;
                      }, "Рейсы смены удалены"),
                  },
                  cancel: { label: "Отмена", onClick: () => {} },
                  duration: 8000,
                })
              }
            >
              <Trash2 className="size-4" /> Удалить все рейсы смены ({shiftTrips.length})
            </Button>
          </div>
        ) : null}
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
          {(showAllTrips ? shiftFeed : shiftFeed.slice(0, 25)).map((t) => {
            const isSelected = selected.has(t.id);
            return (
              <div
                key={t.id}
                className={`flex items-center gap-2 p-3 text-sm ${isSelected ? "bg-destructive/10" : ""}`}
                onClick={
                  selectMode
                    ? () =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          return next;
                        })
                    : undefined
                }
              >
                {selectMode ? (
                  <input type="checkbox" readOnly checked={isSelected} className="size-5 accent-destructive" />
                ) : (
                  <Check className="size-4 text-green-600" />
                )}
                <span className="flex-1">
                  {vehById.get(t.vehicle_id)?.reg_number ?? "—"}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {drvById.get(t.driver_id)?.full_name ?? ""}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{fmtTime(t.at)}</span>
                {!selectMode ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-destructive"
                    onClick={async () => {
                      const res = await deleteTrip(t.id);
                      if (res.ok) { toast.success("Рейс отменён"); router.refresh(); }
                      else { devError("deleteTrip", res.error); toast.error(res.error ?? "Ошибка"); }
                    }}
                  >
                    <Trash2 className="size-4" /> Отменить
                  </Button>
                ) : null}
              </div>
            );
          })}
          {shiftFeed.length > 25 && !showAllTrips ? (
            <button className="p-2.5 text-sm text-primary underline" onClick={() => setShowAllTrips(true)}>
              Показать все ({shiftFeed.length})
            </button>
          ) : null}
          {entries.length === 0 && shiftFeed.length === 0 ? (
            <EmptyState icon={Truck} title="Рейсов за смену пока нет" description="Отсканируйте QR машины или выберите её выше — рейс запишется в два касания. Прошлые смены — в журнале рейсов." className="border-0 p-6" />
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

      {/* Подпись мастера — закрытие карточки смены */}
      {signClose ? (
        <SignaturePad
          signerName="Мастер — закрытие смены"
          onDone={async (dataUrl) => {
            setSignClose(false);
            try {
              const path = await uploadSignature(data.orgId, dataUrl);
              act(() => closeTripJournal({ lineup_id: lineup.id, signature_path: path }), "Смена закрыта — рейсы в расчётах");
              setReviewOpen(false);
            } catch (err) {
              devError("close-shift-signature", err);
              toast.error("Не удалось загрузить подпись");
            }
          }}
          onCancel={() => setSignClose(false)}
        />
      ) : null}
    </div>
  );
}

/** Сводка карточки смены: рейсы по машинам, в режиме проверки — с корректировкой ±. */
function ShiftSummary({
  tripsByVehicle,
  vehicles,
  lineupVehicleIds,
  editable = false,
  busy = false,
  onPlus,
  onMinus,
}: {
  tripsByVehicle: Map<string, { count: number; lastId: string }>;
  vehicles: TripsScreenData["vehicles"];
  lineupVehicleIds: string[];
  editable?: boolean;
  busy?: boolean;
  onPlus?: (vehicleId: string) => void;
  onMinus?: (lastTripId: string) => void;
}) {
  const ids = new Set([...lineupVehicleIds, ...tripsByVehicle.keys()]);
  const rows = vehicles
    .filter((v) => ids.has(v.id))
    .map((v) => ({ v, stat: tripsByVehicle.get(v.id) }))
    .sort((a, b) => (b.stat?.count ?? 0) - (a.stat?.count ?? 0) || a.v.reg_number.localeCompare(b.v.reg_number, "ru"));
  const total = [...tripsByVehicle.values()].reduce((s, x) => s + x.count, 0);

  return (
    <div className="flex flex-col divide-y rounded-lg border">
      {rows.map(({ v, stat }) => (
        <div key={v.id} className="flex items-center gap-2 p-2.5 text-sm">
          <span className="flex-1 font-medium">{v.reg_number}</span>
          {editable && stat ? (
            <Button variant="outline" size="icon" className="size-9" disabled={busy} aria-label="Убрать рейс"
              onClick={() => onMinus?.(stat.lastId)}>
              −
            </Button>
          ) : null}
          <span className={`w-10 text-center text-lg font-bold tabular-nums ${stat ? "" : "text-muted-foreground"}`}>
            {stat?.count ?? 0}
          </span>
          {editable ? (
            <Button variant="outline" size="icon" className="size-9" disabled={busy} aria-label="Добавить рейс"
              onClick={() => onPlus?.(v.id)}>
              +
            </Button>
          ) : null}
        </div>
      ))}
      <div className="flex items-center justify-between p-2.5 text-sm font-semibold">
        <span>Итого рейсов</span>
        <span className="tabular-nums">{total}</span>
      </div>
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
