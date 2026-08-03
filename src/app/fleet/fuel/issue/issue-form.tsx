"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { Camera, Check, Clock, Images, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GroupLabel } from "@/components/ui/group-label";
import { ru } from "@/lib/i18n/ru";
import { cn } from "@/lib/utils";
import { NumberKeypad } from "@/components/field/number-keypad";
import { SignaturePad } from "@/components/field/signature-pad";
import { QrScanner } from "@/components/field/qr-scanner";
import { VehiclePicker } from "@/components/field/vehicle-picker";
import { OutboxList } from "@/components/field/outbox-list";
import { uploadReceipt, uploadSignature } from "@/lib/storage/upload";
import { devLog } from "@/lib/dev-log";
import { compressImage } from "@/lib/images/compress";
import { useOutbox, type SubmitResult } from "@/lib/outbox/use-outbox";
import { fmtLiters, fmtInt } from "@/lib/format";
import { driverGroups, driverPoolFor, vehicleTypeLabel } from "@/lib/domain";
import type { FuelIssueData } from "@/lib/data/fuel-issue";
import { createFuelIssue, undoLastFuelIssue } from "./actions";

const LAST_SOURCE_KEY = "qo-last-source";

/**
 * Окно повторной заправки. Повтор в течение смены законен (за июль — 30 случаев),
 * поэтому не запрет, а переспрос прямо в плитке: цена ошибки — двойные литры и
 * двойное удержание с подрядчика.
 */
const DUP_WINDOW_MIN = 15;

/** Запасные пресеты, если вид техники неизвестен. */
const PRESETS_DEFAULT = [150, 200, 300];

/** Что мешает выдаче — ключ нужен, чтобы предложить выход именно по чеку. */
type MissKey = "source" | "vehicle" | "driver" | "liters" | "receipt" | "signature";

/**
 * Что кладём в очередь: сырые данные выдачи вместе с подписью (SVG, ~2 КБ) и
 * сжатым фото чека. Пути в Storage появляются только в момент отправки —
 * иначе при обрыве связи запись осталась бы без файлов.
 */
interface IssuePayload {
  orgId: string;
  signatureSvg: string;
  receipt: File | null;
  source_type: "card" | "tanker";
  fuel_card_id: string | null;
  tanker_id: string | null;
  vehicle_id: string;
  driver_id: string;
  liters: number;
  odometer: number | null;
  /**
   * Ключ операции и момент выдачи создаются ОДИН раз — при постановке в
   * очередь. Досылка после потерянного ответа отправляет их же: повтор упрётся
   * в уникальный индекс, а выдача останется в своей смене и своих сутках, даже
   * если ушла с телефона через несколько часов.
   */
  client_key: string;
  issued_at: string;
}

export function IssueForm({ data }: { data: FuelIssueData }) {
  const {
    orgId, cards, tankers, vehicles, drivers, balances, lastDriverByVehicle,
    todayVehicleIds, lastIssueByVehicle, presetsByType,
  } = data;

  const [sourceKey, setSourceKey] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(LAST_SOURCE_KEY);
  });
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [liters, setLiters] = useState("");
  const [odometer, setOdometer] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  /** Заправщик согласился донести чек позже — выдача не должна упираться в него. */
  const [receiptDeferred, setReceiptDeferred] = useState(false);
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [showSig, setShowSig] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [miss, setMiss] = useState<{ key: MissKey; msg: string } | null>(null);
  const [result, setResult] = useState<{ text: string; queued: boolean } | null>(null);
  const [undoing, setUndoing] = useState(false);
  /** Выдачи этой сессии: сервер о них ещё мог не знать, а повтор ловить надо. */
  const [sessionIssues, setSessionIssues] = useState<Record<string, { at: number; liters: number }>>({});
  /**
   * Вопрос «заправляли только что, ещё раз?» в плитке. Давность считается в
   * обработчике и кладётся в state: во время рендера Date.now() вызывать нельзя.
   */
  const [dup, setDup] = useState<{ id: string; minutes: number; liters: number } | null>(null);
  const [pending, startTransition] = useTransition();

  // Якоря для «Выдать»: если чего-то не хватает, фокус уезжает на нужный блок.
  const sourceRef = useRef<HTMLDivElement>(null);
  const vehicleRef = useRef<HTMLElement>(null);
  const driverRef = useRef<HTMLSelectElement>(null);
  const litersRef = useRef<HTMLOutputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const signRef = useRef<HTMLButtonElement>(null);

  const sourceType = sourceKey?.startsWith("card:")
    ? "card"
    : sourceKey?.startsWith("tanker:")
      ? "tanker"
      : null;
  const sourceId = sourceKey?.split(":")[1] ?? null;
  const tankerBalance =
    sourceType === "tanker" && sourceId ? balances[sourceId] ?? 0 : null;
  const sourceName =
    sourceType === "card"
      ? cards.find((c) => c.id === sourceId)?.card_number ?? "счёт АЗС"
      : tankers.find((t) => t.id === sourceId)?.name ?? "бензовоз";

  // Отправка выдачи: загрузка подписи и чека + вставка записи. Всё внутри
  // очереди, чтобы при обрыве связи повторилось целиком, а не наполовину.
  const submitIssue = useCallback(async (p: IssuePayload): Promise<SubmitResult> => {
    const signature_path = await uploadSignature(p.orgId, p.signatureSvg);
    const receipt_path = p.receipt ? await uploadReceipt(p.orgId, p.receipt) : null;
    return createFuelIssue({
      source_type: p.source_type,
      fuel_card_id: p.fuel_card_id,
      tanker_id: p.tanker_id,
      vehicle_id: p.vehicle_id,
      driver_id: p.driver_id,
      liters: p.liters,
      odometer: p.odometer,
      receipt_path,
      signature_path,
      client_key: p.client_key,
      issued_at: p.issued_at,
    });
  }, []);
  const {
    entries: queued,
    add: addToOutbox,
    remove: removeQueued,
  } = useOutbox<IssuePayload>("fuel_issue", submitIssue);

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;

  // Сквозной подход: «свои» водители машины (штатные/договор/ИП) сверху, остальные ниже.
  const driverOptions = useMemo(() => driverGroups(vehicle, drivers), [drivers, vehicle]);

  const litersNum = parseFloat(liters || "0");
  const overBalance =
    tankerBalance != null && litersNum > 0 && litersNum > tankerBalance;

  /** Недавняя выдача по машине — из истории сервера и из этой сессии. */
  function recentIssue(id: string): { minutes: number; liters: number } | null {
    const now = Date.now();
    const found: { at: number; liters: number }[] = [];
    const s = sessionIssues[id];
    if (s) found.push(s);
    const srv = lastIssueByVehicle[id];
    if (srv) found.push({ at: Date.parse(srv.at), liters: srv.liters });
    const fresh = found
      .filter((f) => now - f.at < DUP_WINDOW_MIN * 60_000)
      .sort((a, b) => b.at - a.at)[0];
    if (!fresh) return null;
    return { minutes: Math.max(1, Math.round((now - fresh.at) / 60_000)), liters: fresh.liters };
  }

  function chooseSource(key: string) {
    setSourceKey(key);
    localStorage.setItem(LAST_SOURCE_KEY, key);
  }

  function selectVehicle(id: string) {
    setVehicleId(id);
    setResult(null);
    setMiss(null);
    const last = lastDriverByVehicle[id];
    const v = vehicles.find((x) => x.id === id);
    const pool = driverPoolFor(v, drivers);
    setDriverId(last ?? pool[0]?.id ?? drivers[0]?.id ?? null);
  }

  /** Выбор из списка: если машину только что заправляли — сперва переспросить. */
  function pickVehicle(id: string) {
    const r = recentIssue(id);
    if (r) {
      setDup({ id, ...r });
      return;
    }
    selectVehicle(id);
  }

  function onQrDetected(text: string) {
    setShowQr(false);
    const t = text.trim();
    const match =
      vehicles.find((v) => v.qr_code === t) ??
      vehicles.find((v) => v.reg_number.replace(/\s/g, "") === t.replace(/\s/g, ""));
    if (match) pickVehicle(match.id);
    else setMiss({ key: "vehicle", msg: ru.errors.qrUnknown });
  }

  async function onReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0] ?? null;
    if (!raw) return;
    // Сжимаем сразу при выборе: этот же файл может лечь в очередь и ждать связь,
    // а снимок с камеры весит 2–4 МБ. Секунда-две обработки без индикатора
    // выглядела как зависший телефон.
    setReceiptBusy(true);
    try {
      const f = await compressImage(raw);
      setReceiptFile(f);
      setReceiptUrl(URL.createObjectURL(f));
      setReceiptDeferred(false);
    } finally {
      setReceiptBusy(false);
    }
  }

  /**
   * Первое незаполненное место: текст для заправщика + куда увести фокус.
   * Кнопка «Выдать» не гаснет — серая кнопка не объясняла, чего не хватает.
   */
  function firstMissing(): { key: MissKey; msg: string; el: HTMLElement | null } | null {
    if (!sourceType)
      return { key: "source", msg: "Выберите источник топлива — счёт АЗС или бензовоз.", el: sourceRef.current };
    if (!vehicleId) return { key: "vehicle", msg: "Выберите технику.", el: vehicleRef.current };
    if (!driverId) return { key: "driver", msg: "Выберите водителя.", el: driverRef.current };
    if (!(litersNum > 0)) return { key: "liters", msg: "Введите литры.", el: litersRef.current };
    if (sourceType === "card" && !receiptFile && !receiptDeferred)
      return {
        key: "receipt",
        msg: "Сфотографируйте чек — по счёту АЗС он обязателен.",
        el: receiptRef.current,
      };
    if (!sigDataUrl)
      return { key: "signature", msg: "Возьмите подпись водителя.", el: signRef.current };
    return null;
  }

  function submit() {
    const m = firstMissing();
    if (m) {
      setMiss({ key: m.key, msg: m.msg });
      m.el?.focus();
      m.el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (!sourceType || !vehicleId || !driverId || !sigDataUrl) return;
    setMiss(null);
    const veh = vehicles.find((v) => v.id === vehicleId);
    const label = `${veh?.reg_number ?? "машина"} · ${fmtLiters(litersNum)}`;
    const doneVehicleId = vehicleId;
    const doneLiters = litersNum;

    startTransition(async () => {
      devLog("issue-form", "выдача в очередь", {
        sourceType, sourceId, vehicleId, driverId, litersNum, odometer,
        hasReceipt: !!receiptFile, receiptDeferred, hasSignature: !!sigDataUrl,
      });

      // Запись кладётся в очередь и уходит сразу, если связь есть. При обрыве
      // остаётся на телефоне вместе с подписью и чеком — раньше терялась.
      const fate = await addToOutbox(
        {
          orgId,
          signatureSvg: sigDataUrl,
          receipt: receiptFile,
          source_type: sourceType as "card" | "tanker",
          fuel_card_id: sourceType === "card" ? sourceId : null,
          tanker_id: sourceType === "tanker" ? sourceId : null,
          vehicle_id: vehicleId,
          driver_id: driverId,
          liters: litersNum,
          odometer: odometer ? parseFloat(odometer) : null,
          client_key: crypto.randomUUID(),
          issued_at: new Date().toISOString(),
        },
        label,
      );

      // Отклик без глаз: заправщик держит пистолет и не смотрит в экран.
      navigator.vibrate?.(fate === "sent" ? 30 : [30, 80, 30]);
      setSessionIssues((s) => ({ ...s, [doneVehicleId]: { at: Date.now(), liters: doneLiters } }));
      setResult({
        text: `${fmtLiters(doneLiters)} · ${veh?.reg_number ?? ""}`,
        queued: fate === "queued",
      });
      // сброс для следующей записи (источник запоминаем)
      setVehicleId(null);
      setDriverId(null);
      setLiters("");
      setOdometer("");
      setReceiptFile(null);
      setReceiptUrl(null);
      setReceiptDeferred(false);
      setSigDataUrl(null);
    });
  }

  /** Отмена только что записанной выдачи: промах по кнопке дешевле звонка админу. */
  async function undo() {
    if (!result) return;
    setUndoing(true);
    try {
      if (result.queued) {
        // Ещё на телефоне — достаточно убрать из очереди.
        const newest = [...queued].sort((a, b) => b.createdAt - a.createdAt)[0];
        if (newest) await removeQueued(newest.id);
        setResult(null);
        return;
      }
      const res = await undoLastFuelIssue();
      if (res.ok) setResult(null);
      else setMiss({ key: "vehicle", msg: res.error });
    } finally {
      setUndoing(false);
    }
  }

  // Источник топлива — используется и в обычном потоке, и внутри закреплённого
  // блока выбора техники (чтобы «Счёт АЗС / Бензовоз» не уезжал при листании).
  const sourceBlock = (
    <div
      className="flex flex-col gap-2"
      role="group"
      aria-labelledby="source-label"
      ref={sourceRef}
      tabIndex={-1}
    >
      <GroupLabel id="source-label">Источник топлива</GroupLabel>
      <div className="flex flex-wrap gap-2">
        {cards.map((c) => {
          const key = `card:${c.id}`;
          return (
            <Button
              key={key}
              type="button"
              variant={sourceKey === key ? "default" : "outline"}
              className="h-12"
              aria-pressed={sourceKey === key}
              onClick={() => chooseSource(key)}
            >
              {c.card_number}
            </Button>
          );
        })}
        {tankers.map((t) => {
          const key = `tanker:${t.id}`;
          return (
            <Button
              key={key}
              type="button"
              variant={sourceKey === key ? "default" : "outline"}
              className="h-12"
              aria-pressed={sourceKey === key}
              onClick={() => chooseSource(key)}
            >
              {t.name}
            </Button>
          );
        })}
      </div>
      {sourceType === "tanker" ? (
        // role="status" — остаток и предупреждение о перерасходе меняются
        // на ходу, без живой области они молча проходили мимо читалки.
        <p
          role="status"
          className={cn("text-sm", overBalance ? "text-destructive" : "text-muted-foreground")}
        >
          Остаток бензовоза: {fmtLiters(tankerBalance)}
          {overBalance ? " · выдаётся больше остатка!" : ""}
        </p>
      ) : null}
    </div>
  );

  return (
    // Запас снизу = высота закреплённой панели выдачи + нижнее меню.
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 pb-[calc(6rem_+_var(--app-bottom-nav,0px))]">
      {result ? (
        <div
          role="status"
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm",
            result.queued ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10",
          )}
        >
          {result.queued ? (
            <Clock className="size-5 shrink-0 text-warning" />
          ) : (
            <Check className="size-5 shrink-0 text-success" />
          )}
          <span className="font-medium">{result.text}</span>
          {/* «Выдано» до подтверждения сервером было неправдой: при плохой связи
              человек уходил с зелёной галочкой, а запись лежала на телефоне. */}
          <span className="text-muted-foreground">
            {result.queued ? "на телефоне · уйдёт при связи" : "записано"}
          </span>
          <Button
            variant="ghost"
            className="ml-auto min-h-11 underline"
            loading={undoing}
            onClick={undo}
          >
            Отменить
          </Button>
        </div>
      ) : null}

      <OutboxList entries={queued} onRemove={removeQueued} />

      {/* Выбор техники — пока он не сделан, остальные блоки на экране не нужны:
          это единственное, что заправщик может сейчас сделать. */}
      {!vehicle ? (
        <section ref={vehicleRef} tabIndex={-1}>
          <VehiclePicker
            vehicles={vehicles}
            onSelect={(v) => pickVehicle(v.id)}
            stickyFilters
            header={sourceBlock}
            priorityIds={todayVehicleIds}
            tileConfirm={(v) => {
              if (dup?.id !== v.id) return null;
              return (
                <div className="flex w-full flex-col gap-1.5">
                  <p className="text-xs font-medium leading-tight">
                    {v.reg_number}: {fmtInt(dup.liters)} л {dup.minutes} мин назад
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 px-1 text-xs"
                      onClick={() => setDup(null)}
                    >
                      Отмена
                    </Button>
                    <Button
                      type="button"
                      className="h-11 px-1 text-xs"
                      onClick={() => {
                        setDup(null);
                        selectVehicle(v.id);
                      }}
                    >
                      Ещё раз
                    </Button>
                  </div>
                </div>
              );
            }}
            searchTrailing={
              <Button
                type="button"
                variant="secondary"
                className="h-12 shrink-0"
                onClick={() => setShowQr(true)}
              >
                <ScanLine className="size-5" /> QR
              </Button>
            }
          />
        </section>
      ) : (
        <>
          <section>{sourceBlock}</section>

          <section className="flex flex-col gap-2" role="group" aria-labelledby="vehicle-label">
            <GroupLabel id="vehicle-label">Техника</GroupLabel>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-xl font-bold tracking-tight">{vehicle.reg_number}</p>
                <p className="text-sm text-muted-foreground">
                  {vehicle.brand} · {vehicleTypeLabel(vehicle.vehicle_type)}
                </p>
              </div>
              <Button variant="ghost" size="field" onClick={() => setVehicleId(null)}>
                Сменить
              </Button>
            </div>
          </section>

          {/* Литры идут сразу за техникой: на колонке их видно последними, и
              раньше за ними приходилось прокручивать через водителя и одометр. */}
          <section className="flex flex-col gap-2" role="group" aria-labelledby="liters-label">
            <GroupLabel id="liters-label">Литры</GroupLabel>
            {/* <output> вместо <div>: у кейпада нет поля ввода, и нажатия цифр
                ничего не сообщали — набранное значение читалось только глазами. */}
            <output
              ref={litersRef}
              tabIndex={-1}
              aria-live="polite"
              aria-label="Набрано литров"
              className="block rounded-lg border p-3 text-right text-4xl font-bold tabular-nums"
            >
              {liters || "0"}
              <span className="ml-1 text-lg text-muted-foreground">л</span>
            </output>
            {/* Пресеты по виду техники: общие 150/200/250/300 попадали в 16 %
                выдач — у погрузчика типовая заправка 130 л, у экскаватора 400 л. */}
            <NumberKeypad
              value={liters}
              onChange={setLiters}
              presets={presetsByType[vehicle.vehicle_type] ?? PRESETS_DEFAULT}
            />
          </section>

          <section className="flex flex-col gap-2">
            <Label htmlFor="driver">Водитель</Label>
            <select
              id="driver"
              ref={driverRef}
              value={driverId ?? ""}
              onChange={(e) => setDriverId(e.target.value)}
              className="h-12 rounded-md border bg-background px-3 text-base"
            >
              {driverOptions.primary.length ? (
                <>
                  <optgroup label="Водители машины">
                    {driverOptions.primary.map((d) => (
                      <option key={d.id} value={d.id}>{d.full_name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Остальные">
                    {driverOptions.rest.map((d) => (
                      <option key={d.id} value={d.id}>{d.full_name}</option>
                    ))}
                  </optgroup>
                </>
              ) : (
                driverOptions.rest.map((d) => (
                  <option key={d.id} value={d.id}>{d.full_name}</option>
                ))
              )}
            </select>
          </section>

          <section className="flex flex-col gap-2">
            <Label htmlFor="odometer">Пробег / моточасы (необязательно)</Label>
            <Input
              id="odometer"
              inputMode="decimal"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-12"
            />
          </section>

          <section className="flex flex-col gap-2">
            <Label htmlFor="receipt">
              Фото чека{sourceType === "card" ? " (обязательно)" : " (необязательно)"}
            </Label>
            {/* Камера и галерея раздельно: capture="environment" не даёт выбрать
                готовый снимок, а чек нередко фотографируют раньше или позже. */}
            <div className="grid grid-cols-2 gap-2">
              <label
                htmlFor="receipt"
                className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
              >
                <Camera className="size-5" />
                {receiptFile ? "Переснять" : "Снять"}
                {/* sr-only, а не hidden: `display:none` убирает поле из фокуса. */}
                <input
                  id="receipt"
                  ref={receiptRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={onReceiptChange}
                />
              </label>
              <label
                htmlFor="receipt-gallery"
                className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
              >
                <Images className="size-5" />
                Из галереи
                <input
                  id="receipt-gallery"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={onReceiptChange}
                />
              </label>
            </div>
            {receiptBusy ? (
              <p role="status" className="text-sm text-muted-foreground">
                Обработка фото…
              </p>
            ) : null}
            {receiptDeferred && !receiptFile ? (
              <p role="status" className="text-sm text-warning">
                Чек будет донесён позже — выдача уйдёт без него.
              </p>
            ) : null}
            {receiptUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={receiptUrl} alt="Чек" className="max-h-40 rounded-lg border object-contain" />
            ) : null}
          </section>

          <section className="flex flex-col gap-2" role="group" aria-labelledby="sign-label">
            <GroupLabel id="sign-label">Подпись водителя (обязательно)</GroupLabel>
            <Button
              type="button"
              ref={signRef}
              variant={sigDataUrl ? "secondary" : "outline"}
              className="h-14"
              onClick={() => {
                // Кнопка больше не гаснет: серая кнопка не объясняла, что сперва
                // нужен водитель. Проверка — на нажатии, с уводом фокуса.
                if (!driverId) {
                  setMiss({ key: "driver", msg: "Сначала выберите водителя — он подписывает выдачу." });
                  driverRef.current?.focus();
                  return;
                }
                setShowSig(true);
              }}
            >
              {sigDataUrl ? (
                <>
                  <Check className="size-5 text-success" /> Подпись получена — изменить
                </>
              ) : (
                "Поставить подпись"
              )}
            </Button>
          </section>
        </>
      )}

      {miss ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">{miss.msg}</p>
          {miss.key === "receipt" ? (
            // Иначе выдача по счёту АЗС (это половина всех) не доводится до конца
            // вообще: чека под рукой нет, а без него экран не пускает.
            <Button
              type="button"
              variant="outline"
              size="field"
              onClick={() => {
                setReceiptDeferred(true);
                setMiss(null);
              }}
            >
              Чек добавлю позже
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Закреплённая кнопка выдачи: поднята над нижним меню (--app-bottom-nav из AppShell),
          иначе нижняя треть панели с главным действием экрана уходит под tab-bar.
          Пока техника не выбрана, панель не нужна — на экране только список. */}
      {vehicle ? (
        <div
          className="fixed inset-x-0 z-30 border-t bg-background p-3"
          style={{ bottom: "var(--app-bottom-nav, 0px)" }}
        >
          <div className="mx-auto max-w-md">
            <Button className="h-14 w-full text-lg" loading={pending} onClick={submit}>
              {pending ? "Сохранение…" : `Выдать ${litersNum > 0 ? fmtInt(litersNum) + " л" : ""}`}
            </Button>
          </div>
        </div>
      ) : null}

      {showSig ? (
        <SignaturePad
          signerName={drivers.find((d) => d.id === driverId)?.full_name ?? "Водитель"}
          subject={`${fmtInt(litersNum)} л · ${vehicle?.reg_number ?? ""} · ${sourceName}`}
          onDone={(dataUrl) => {
            setSigDataUrl(dataUrl);
            setShowSig(false);
          }}
          onCancel={() => setShowSig(false)}
        />
      ) : null}

      {showQr ? (
        <QrScanner onDetected={onQrDetected} onCancel={() => setShowQr(false)} />
      ) : null}
    </div>
  );
}
