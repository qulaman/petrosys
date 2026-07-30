"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { Camera, Check, ScanLine } from "lucide-react";
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
import { toast } from "sonner";
import { uploadReceipt, uploadSignature } from "@/lib/storage/upload";
import { devLog } from "@/lib/dev-log";
import { compressImage } from "@/lib/images/compress";
import { useOutbox, type SubmitResult } from "@/lib/outbox/use-outbox";
import { fmtLiters, fmtInt } from "@/lib/format";
import { driverGroups, driverPoolFor, vehicleTypeLabel } from "@/lib/domain";
import type { FuelIssueData } from "@/lib/data/fuel-issue";
import { createFuelIssue } from "./actions";

const LAST_SOURCE_KEY = "qo-last-source";

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
}

export function IssueForm({ data }: { data: FuelIssueData }) {
  const { orgId, cards, tankers, vehicles, drivers, balances, lastDriverByVehicle } =
    data;

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
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [showSig, setShowSig] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
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

  function chooseSource(key: string) {
    setSourceKey(key);
    localStorage.setItem(LAST_SOURCE_KEY, key);
  }

  function selectVehicle(id: string) {
    setVehicleId(id);
    const last = lastDriverByVehicle[id];
    const v = vehicles.find((x) => x.id === id);
    const pool = driverPoolFor(v, drivers);
    setDriverId(last ?? pool[0]?.id ?? drivers[0]?.id ?? null);
  }

  function onQrDetected(text: string) {
    setShowQr(false);
    const t = text.trim();
    const match =
      vehicles.find((v) => v.qr_code === t) ??
      vehicles.find((v) => v.reg_number.replace(/\s/g, "") === t.replace(/\s/g, ""));
    if (match) selectVehicle(match.id);
    else setError(ru.errors.qrUnknown);
  }

  async function onReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0] ?? null;
    // Сжимаем сразу при выборе: этот же файл может лечь в очередь и ждать связь,
    // а снимок с камеры весит 2–4 МБ.
    const f = raw ? await compressImage(raw) : null;
    setReceiptFile(f);
    setReceiptUrl(f ? URL.createObjectURL(f) : null);
  }

  /**
   * Первое незаполненное место: текст для заправщика + куда увести фокус.
   * Кнопка «Выдать» больше не гаснет — серая кнопка не объясняла, чего не
   * хватает, и на смене приходилось искать пропуск глазами.
   */
  function firstMissing(): { msg: string; el: HTMLElement | null } | null {
    if (!sourceType)
      return { msg: "Выберите источник топлива — счёт АЗС или бензовоз.", el: sourceRef.current };
    if (!vehicleId) return { msg: "Выберите технику.", el: vehicleRef.current };
    if (!driverId) return { msg: "Выберите водителя.", el: driverRef.current };
    if (!(litersNum > 0)) return { msg: "Введите литры.", el: litersRef.current };
    if (sourceType === "card" && !receiptFile)
      return {
        msg: "Сфотографируйте чек — по счёту АЗС он обязателен.",
        el: receiptRef.current,
      };
    if (!sigDataUrl)
      return { msg: "Возьмите подпись водителя.", el: signRef.current };
    return null;
  }

  function submit() {
    const miss = firstMissing();
    if (miss) {
      setError(miss.msg);
      miss.el?.focus();
      miss.el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (!sourceType || !vehicleId || !driverId || !sigDataUrl) return;
    setError(null);
    const veh = vehicles.find((v) => v.id === vehicleId);
    const label = `${veh?.reg_number ?? "машина"} · ${fmtLiters(litersNum)}`;

    startTransition(async () => {
      devLog("issue-form", "выдача в очередь", {
        sourceType, sourceId, vehicleId, driverId, litersNum, odometer,
        hasReceipt: !!receiptFile, hasSignature: !!sigDataUrl,
      });

      // Запись кладётся в очередь и уходит сразу, если связь есть. При обрыве
      // остаётся на телефоне вместе с подписью и чеком — раньше терялась.
      await addToOutbox(
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
        },
        label,
      );

      toast.success(`Выдано ${fmtLiters(litersNum)} · ${veh?.reg_number ?? ""}`);
      setDone(`Выдано ${fmtLiters(litersNum)} · ${veh?.reg_number ?? ""}`);
      // сброс для следующей записи (источник запоминаем)
      setVehicleId(null);
      setDriverId(null);
      setLiters("");
      setOdometer("");
      setReceiptFile(null);
      setReceiptUrl(null);
      setSigDataUrl(null);
    });
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
      {done ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm"
        >
          <Check className="size-5 text-success" />
          <span>{done}</span>
          <button
            className="ml-auto min-h-11 px-2 underline"
            onClick={() => setDone(null)}
          >
            Ещё выдача
          </button>
        </div>
      ) : null}

      <OutboxList entries={queued} onRemove={removeQueued} />

      {/* 1–2. Источник + техника */}
      {vehicle ? (
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
        </>
      ) : (
        <section ref={vehicleRef} tabIndex={-1}>
          <VehiclePicker
            vehicles={vehicles}
            onSelect={(v) => selectVehicle(v.id)}
            stickyFilters
            header={sourceBlock}
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
      )}

      {/* 3. Водитель */}
      {vehicle ? (
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
      ) : null}

      {/* 4. Литры */}
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
        <NumberKeypad value={liters} onChange={setLiters} />
      </section>

      {/* 5. Одометр/моточасы (опционально) */}
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

      {/* 6. Чек */}
      <section className="flex flex-col gap-2">
        <Label htmlFor="receipt">
          Фото чека{sourceType === "card" ? " (обязательно)" : " (необязательно)"}
        </Label>
        <label
          htmlFor="receipt"
          className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
        >
          <Camera className="size-5" />
          {receiptFile ? "Заменить фото" : "Сделать фото"}
          {/* sr-only, а не hidden: `display:none` убирает поле из фокуса, и снять
              фото с клавиатуры было невозможно — а по счёту АЗС чек обязателен,
              то есть выдача не доводилась до конца вообще. */}
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
        {receiptUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={receiptUrl} alt="Чек" className="max-h-40 rounded-lg border object-contain" />
        ) : null}
      </section>

      {/* 7. Подпись */}
      <section className="flex flex-col gap-2" role="group" aria-labelledby="sign-label">
        <GroupLabel id="sign-label">Подпись водителя (обязательно)</GroupLabel>
        <Button
          type="button"
          ref={signRef}
          variant={sigDataUrl ? "secondary" : "outline"}
          className="h-14"
          onClick={() => setShowSig(true)}
          disabled={!driverId}
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

      {error ? (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {/* Закреплённая кнопка выдачи: поднята над нижним меню (--app-bottom-nav из AppShell),
          иначе нижняя треть панели с главным действием экрана уходит под tab-bar. */}
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

      {showSig ? (
        <SignaturePad
          signerName={drivers.find((d) => d.id === driverId)?.full_name ?? "Водитель"}
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
