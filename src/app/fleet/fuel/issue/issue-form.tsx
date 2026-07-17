"use client";

import { useMemo, useState, useTransition } from "react";
import { Camera, Check, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { NumberKeypad } from "@/components/field/number-keypad";
import { SignaturePad } from "@/components/field/signature-pad";
import { QrScanner } from "@/components/field/qr-scanner";
import { VehiclePicker } from "@/components/field/vehicle-picker";
import { toast } from "sonner";
import { uploadReceipt, uploadSignature } from "@/lib/storage/upload";
import { devError, devLog } from "@/lib/dev-log";
import { fmtLiters, fmtInt } from "@/lib/format";
import { driverPoolFor, vehicleTypeLabel } from "@/lib/domain";
import type { FuelIssueData } from "@/lib/data/fuel-issue";
import { createFuelIssue } from "./actions";

const LAST_SOURCE_KEY = "qo-last-source";

function getGeo(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, enableHighAccuracy: false },
    );
  });
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

  const sourceType = sourceKey?.startsWith("card:")
    ? "card"
    : sourceKey?.startsWith("tanker:")
      ? "tanker"
      : null;
  const sourceId = sourceKey?.split(":")[1] ?? null;
  const tankerBalance =
    sourceType === "tanker" && sourceId ? balances[sourceId] ?? 0 : null;

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;

  const driverOptions = useMemo(() => {
    const pool = driverPoolFor(vehicle, drivers);
    // выбранный водитель (по последним записям) всегда присутствует в списке
    if (driverId && !pool.some((d) => d.id === driverId)) {
      return [...pool, ...drivers.filter((d) => d.id === driverId)];
    }
    return pool;
  }, [drivers, vehicle, driverId]);

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
    else setError("QR не распознан. Выберите машину из списка.");
  }

  function onReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setReceiptFile(f);
    setReceiptUrl(f ? URL.createObjectURL(f) : null);
  }

  const canSubmit =
    !!sourceType &&
    !!vehicleId &&
    !!driverId &&
    litersNum > 0 &&
    !!sigDataUrl &&
    (sourceType !== "card" || !!receiptFile);

  function submit() {
    if (!canSubmit || !sourceType || !vehicleId || !driverId || !sigDataUrl) return;
    setError(null);
    startTransition(async () => {
      try {
        devLog("issue-form", "старт выдачи", {
          sourceType, sourceId, vehicleId, driverId, litersNum, odometer,
          hasReceipt: !!receiptFile, hasSignature: !!sigDataUrl,
        });

        const geo = await getGeo();
        devLog("issue-form", "гео:", geo);

        const signature_path = await uploadSignature(orgId, sigDataUrl);
        devLog("issue-form", "подпись загружена:", signature_path);

        const receipt_path = receiptFile
          ? await uploadReceipt(orgId, receiptFile)
          : null;
        devLog("issue-form", "чек загружен:", receipt_path);

        const payload = {
          source_type: sourceType as "card" | "tanker",
          fuel_card_id: sourceType === "card" ? sourceId : null,
          tanker_id: sourceType === "tanker" ? sourceId : null,
          vehicle_id: vehicleId,
          driver_id: driverId,
          liters: litersNum,
          odometer: odometer ? parseFloat(odometer) : null,
          receipt_path,
          signature_path,
          geo_lat: geo?.lat ?? null,
          geo_lng: geo?.lng ?? null,
        };
        devLog("issue-form", "payload → createFuelIssue:", payload);

        const res = await createFuelIssue(payload);
        devLog("issue-form", "результат:", res);

        if (!res.ok) {
          devError("issue-form", "выдача отклонена:", res.error);
          setError(res.error);
          toast.error(res.error);
          return;
        }
        const veh = vehicles.find((v) => v.id === vehicleId);
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
      } catch (e) {
        devError("issue-form", "исключение при сохранении:", e);
        const msg = e instanceof Error ? e.message : "Ошибка сохранения";
        setError(msg);
        toast.error(msg);
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 pb-28">
      {done ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-600/40 bg-green-600/10 p-3 text-sm">
          <Check className="size-5 text-green-600" />
          <span>{done}</span>
          <button className="ml-auto underline" onClick={() => setDone(null)}>
            Ещё выдача
          </button>
        </div>
      ) : null}

      {/* 1. Источник */}
      <section className="flex flex-col gap-2">
        <Label>Источник топлива</Label>
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
          <p className={cn("text-sm", overBalance ? "text-destructive" : "text-muted-foreground")}>
            Остаток бензовоза: {fmtLiters(tankerBalance)}
            {overBalance ? " · выдаётся больше остатка!" : ""}
          </p>
        ) : null}
      </section>

      {/* 2. Техника */}
      <section className="flex flex-col gap-2">
        <Label>Техника</Label>
        {vehicle ? (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-xl font-bold tracking-tight">{vehicle.reg_number}</p>
              <p className="text-sm text-muted-foreground">
                {vehicle.brand} · {vehicleTypeLabel(vehicle.vehicle_type)}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setVehicleId(null)}>
              Сменить
            </Button>
          </div>
        ) : (
          <VehiclePicker
            vehicles={vehicles}
            onSelect={(v) => selectVehicle(v.id)}
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
        )}
      </section>

      {/* 3. Водитель */}
      {vehicle ? (
        <section className="flex flex-col gap-2">
          <Label htmlFor="driver">Водитель</Label>
          <select
            id="driver"
            value={driverId ?? ""}
            onChange={(e) => setDriverId(e.target.value)}
            className="h-12 rounded-md border bg-background px-3 text-base"
          >
            {driverOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.full_name}
              </option>
            ))}
          </select>
        </section>
      ) : null}

      {/* 4. Литры */}
      <section className="flex flex-col gap-2">
        <Label>Литры</Label>
        <div className="rounded-lg border p-3 text-right text-4xl font-bold tabular-nums">
          {liters || "0"}
          <span className="ml-1 text-lg text-muted-foreground">л</span>
        </div>
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
        <Label>
          Фото чека{sourceType === "card" ? " (обязательно)" : " (необязательно)"}
        </Label>
        <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed">
          <Camera className="size-5" />
          {receiptFile ? "Заменить фото" : "Сделать фото"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onReceiptChange}
          />
        </label>
        {receiptUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={receiptUrl} alt="Чек" className="max-h-40 rounded-lg border object-contain" />
        ) : null}
      </section>

      {/* 7. Подпись */}
      <section className="flex flex-col gap-2">
        <Label>Подпись водителя (обязательно)</Label>
        <Button
          type="button"
          variant={sigDataUrl ? "secondary" : "outline"}
          className="h-14"
          onClick={() => setShowSig(true)}
          disabled={!driverId}
        >
          {sigDataUrl ? (
            <>
              <Check className="size-5 text-green-600" /> Подпись получена — изменить
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

      {/* Sticky submit */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-background p-3">
        <div className="mx-auto max-w-md">
          <Button
            className="h-14 w-full text-lg"
            loading={pending}
            disabled={!canSubmit}
            onClick={submit}
          >
            {pending ? "Сохранение…" : `Выдать ${litersNum > 0 ? fmtInt(litersNum) + " л" : ""}`}
          </Button>
        </div>
      </div>

      {showSig ? (
        <SignaturePad
          signerName={
            driverOptions.find((d) => d.id === driverId)?.full_name ?? "Водитель"
          }
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
