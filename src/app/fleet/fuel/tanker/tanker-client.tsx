"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Ruler, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { uploadReceipt } from "@/lib/storage/upload";
import { fmtLiters, fmtDateTime } from "@/lib/format";
import type { TankerScreenData } from "@/lib/data/tanker";
import { createMeasurement, createRefill } from "./actions";
import { adminDeleteTankerEvent } from "@/app/fleet/journals/admin-actions";

export function TankerClient({ data, isAdmin = false }: { data: TankerScreenData; isAdmin?: boolean }) {
  const { orgId, cards, tankers, eventsByTanker } = data;
  const router = useRouter();
  const [tankerId, setTankerId] = useState(tankers[0]?.id ?? "");
  const [mode, setMode] = useState<"refill" | "measure">("refill");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // приход
  const [rLiters, setRLiters] = useState("");
  const [rPrice, setRPrice] = useState("");
  const [rSource, setRSource] = useState("");
  const [rCard, setRCard] = useState("");
  const [rFile, setRFile] = useState<File | null>(null);
  // замер
  const [mLiters, setMLiters] = useState("");
  const [mNote, setMNote] = useState("");

  const tanker = tankers.find((t) => t.id === tankerId) ?? null;
  const events = eventsByTanker[tankerId] ?? [];

  const measuredNum = parseFloat(mLiters || "0");
  const measureDiff = useMemo(
    () => (tanker ? measuredNum - tanker.calculated_liters : 0),
    [measuredNum, tanker],
  );

  function reset() {
    setRLiters(""); setRPrice(""); setRSource(""); setRCard(""); setRFile(null);
    setMLiters(""); setMNote("");
  }

  function submitRefill() {
    const liters = parseFloat(rLiters || "0");
    if (!tankerId || liters <= 0) { setError("Введите литры прихода"); return; }
    setError(null);
    start(async () => {
      try {
        const receipt_path = rFile ? await uploadReceipt(orgId, rFile) : null;
        const res = await createRefill({
          tanker_id: tankerId,
          liters,
          price_per_liter: rPrice ? parseFloat(rPrice) : null,
          source: rSource || null,
          fuel_card_id: rCard || null,
          receipt_path,
        });
        if (!res.ok) { setError(res.error); toast.error(res.error); return; }
        toast.success(`Приход ${fmtLiters(liters)} принят`);
        setDone(`Приход ${fmtLiters(liters)} принят`);
        reset();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка");
      }
    });
  }

  function submitMeasure() {
    const measured = parseFloat(mLiters || "0");
    if (!tankerId || mLiters === "") { setError("Введите замеренный остаток"); return; }
    setError(null);
    start(async () => {
      const res = await createMeasurement({
        tanker_id: tankerId,
        measured_liters: measured,
        note: mNote || null,
      });
      if (!res.ok) { setError(res.error); toast.error(res.error); return; }
      toast.success(`Замер сохранён: ${fmtLiters(measured)}`);
      setDone(`Замер сохранён: ${fmtLiters(measured)}`);
      reset();
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      {tankers.length > 1 ? (
        <select
          value={tankerId}
          onChange={(e) => setTankerId(e.target.value)}
          className="h-12 rounded-md border bg-background px-3 text-base"
        >
          {tankers.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      ) : null}

      {/* Баланс */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-muted-foreground">
            {tanker?.name ?? "Бензовоз"} · расчётный остаток
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-4xl font-bold tabular-nums">
            {fmtLiters(tanker?.calculated_liters ?? 0)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tanker?.last_measured_at
              ? `Последний замер: ${fmtLiters(tanker.last_measured_liters)} · ${fmtDateTime(tanker.last_measured_at)}`
              : "Замеров ещё не было"}
          </p>
        </CardContent>
      </Card>

      {done ? (
        <div className="rounded-lg border border-green-600/40 bg-green-600/10 p-3 text-sm">
          {done}{" "}
          <button className="underline" onClick={() => setDone(null)}>ok</button>
        </div>
      ) : null}

      {/* Переключатель режима */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={mode === "refill" ? "default" : "outline"}
          className="h-12"
          onClick={() => setMode("refill")}
        >
          Приход
        </Button>
        <Button
          type="button"
          variant={mode === "measure" ? "default" : "outline"}
          className="h-12"
          onClick={() => setMode("measure")}
        >
          Замер остатка
        </Button>
      </div>

      {mode === "refill" ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="r-liters">Литры прихода</Label>
            <Input id="r-liters" inputMode="decimal" value={rLiters}
              onChange={(e) => setRLiters(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-12 text-lg" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="r-price">Цена за литр (₸)</Label>
            <Input id="r-price" inputMode="decimal" value={rPrice}
              onChange={(e) => setRPrice(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-12" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="r-source">Источник (АЗС / база / поставщик)</Label>
            <Input id="r-source" value={rSource} onChange={(e) => setRSource(e.target.value)} className="h-12" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="r-card">Карта (если приход по карте)</Label>
            <select id="r-card" value={rCard} onChange={(e) => setRCard(e.target.value)}
              className="h-12 rounded-md border bg-background px-3 text-base">
              <option value="">— без карты —</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>{c.card_number}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Фото чека (необязательно)</Label>
            <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed text-sm">
              {rFile ? "Заменить фото" : "Сделать фото"}
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => setRFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="h-14 text-lg" loading={pending} onClick={submitRefill}>
            {pending ? "Сохранение…" : "Принять приход"}
          </Button>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="m-liters">Замеренный остаток (л)</Label>
            <Input id="m-liters" inputMode="decimal" value={mLiters}
              onChange={(e) => setMLiters(e.target.value.replace(/[^\d.]/g, ""))}
              className="h-12 text-lg" />
          </div>
          <p className="text-sm text-muted-foreground">
            Расчётный сейчас: {fmtLiters(tanker?.calculated_liters ?? 0)}
            {mLiters !== "" ? (
              <>
                {" · расхождение "}
                <span className={cn("font-semibold", Math.abs(measureDiff) > 20 ? "text-destructive" : "text-foreground")}>
                  {measureDiff > 0 ? "+" : ""}{fmtLiters(measureDiff)}
                </span>
              </>
            ) : null}
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="m-note">Примечание</Label>
            <Input id="m-note" value={mNote} onChange={(e) => setMNote(e.target.value)} className="h-12" />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="h-14 text-lg" loading={pending} onClick={submitMeasure}>
            {pending ? "Сохранение…" : "Сохранить замер"}
          </Button>
        </section>
      )}

      {/* История */}
      <section className="flex flex-col gap-2">
        <Label>История операций</Label>
        <div className="flex flex-col divide-y rounded-lg border">
          {events.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Операций пока нет</p>
          ) : (
            events.map((e) => (
              <div key={`${e.kind}-${e.id}`} className="flex items-center gap-3 p-3">
                {e.kind === "refill" ? (
                  <ArrowUpRight className="size-5 text-green-600" />
                ) : e.kind === "issue" ? (
                  <ArrowDownRight className="size-5 text-orange-600" />
                ) : (
                  <Ruler className="size-5 text-blue-600" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {e.kind === "refill" && `Приход ${fmtLiters(e.liters)}`}
                    {e.kind === "issue" && `Выдача ${fmtLiters(Math.abs(e.liters ?? 0))}`}
                    {e.kind === "measurement" &&
                      `Замер ${fmtLiters(e.measured)} (расчёт ${fmtLiters(e.calculated)})`}
                  </p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(e.at)}</p>
                </div>
                {isAdmin && e.kind !== "issue" ? (
                  <button
                    aria-label="Удалить (админ)"
                    onClick={() => {
                      if (!window.confirm("Удалить эту операцию? Баланс бензовоза пересчитается.")) return;
                      start(async () => {
                        const res = await adminDeleteTankerEvent(e.kind as "refill" | "measurement", e.id);
                        if (!res.ok) { toast.error(res.error); return; }
                        toast.success("Операция удалена");
                        router.refresh();
                      });
                    }}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
