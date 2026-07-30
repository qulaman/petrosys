"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Fuel, Ruler, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GroupLabel } from "@/components/ui/group-label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { uploadReceipt } from "@/lib/storage/upload";
import { fmtLiters, fmtDateTime } from "@/lib/format";
import { aqtobeDate } from "@/lib/tz";
import { OutboxList } from "@/components/field/outbox-list";
import { useOutbox, type SubmitResult } from "@/lib/outbox/use-outbox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { TankerEvent, TankerScreenData } from "@/lib/data/tanker";
import { createMeasurement, createRefill } from "./actions";
import { adminDeleteTankerEvent, fuelIssueDeleteInfo } from "@/app/fleet/journals/admin-actions";

/** Операция бензовоза в очереди: приход (с фото чека) либо замер остатка. */
type TankerOp =
  | {
      op: "refill";
      orgId: string;
      receipt: File | null;
      tanker_id: string;
      liters: number;
      price_per_liter: number | null;
      source: string | null;
      fuel_card_id: string | null;
    }
  | {
      op: "measure";
      orgId: string;
      receipt: null;
      tanker_id: string;
      measured_liters: number;
      note: string | null;
    };

export function TankerClient({ data, isAdmin = false }: { data: TankerScreenData; isAdmin?: boolean }) {
  const { orgId, cards, tankers, eventsByTanker } = data;
  const router = useRouter();
  const [tankerId, setTankerId] = useState(tankers[0]?.id ?? "");
  const [mode, setMode] = useState<"refill" | "measure">("refill");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  // Обе операции бензовоза идут через одну очередь: приход тянет фото чека,
  // замер — нет, но терять нельзя ни то, ни другое.
  const submitOp = useCallback(async (p: TankerOp): Promise<SubmitResult> => {
    if (p.op === "refill") {
      const receipt_path = p.receipt ? await uploadReceipt(p.orgId, p.receipt) : null;
      return createRefill({
        tanker_id: p.tanker_id,
        liters: p.liters,
        price_per_liter: p.price_per_liter,
        source: p.source,
        fuel_card_id: p.fuel_card_id,
        receipt_path,
      });
    }
    return createMeasurement({
      tanker_id: p.tanker_id,
      measured_liters: p.measured_liters,
      note: p.note,
    });
  }, []);
  const {
    entries: queued,
    add: queueOp,
    remove: dropQueued,
  } = useOutbox<TankerOp>("tanker", submitOp, () => router.refresh());

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
      // Через очередь: приход с фото чека не должен пропадать при обрыве связи.
      await queueOp(
        {
          op: "refill",
          orgId,
          receipt: rFile,
          tanker_id: tankerId,
          liters,
          price_per_liter: rPrice ? parseFloat(rPrice) : null,
          source: rSource || null,
          fuel_card_id: rCard || null,
        },
        `Приход ${fmtLiters(liters)}`,
      );
      toast.success(`Приход ${fmtLiters(liters)} принят`);
      setDone(`Приход ${fmtLiters(liters)} принят`);
      reset();
    });
  }

  function submitMeasure() {
    const measured = parseFloat(mLiters || "0");
    if (!tankerId || mLiters === "") { setError("Введите замеренный остаток"); return; }
    setError(null);
    start(async () => {
      // Раньше обрыв связи ронял server action исключением, оно уходило
      // в unhandled rejection, и человек не узнавал, что замер не сохранён.
      await queueOp(
        { op: "measure", orgId, receipt: null, tanker_id: tankerId, measured_liters: measured, note: mNote || null },
        `Замер ${fmtLiters(measured)}`,
      );
      toast.success(`Замер сохранён: ${fmtLiters(measured)}`);
      setDone(`Замер сохранён: ${fmtLiters(measured)}`);
      reset();
    });
  }

  /**
   * Удаление операции админом. У выдачи последствия шире цистерны — деньги по
   * договору, подпись водителя, возможно уже выпущенный акт, — поэтому перед
   * подтверждением дочитываем контекст с сервера.
   */
  async function deleteEvent(e: TankerEvent) {
    const isIssue = e.kind === "issue";
    let description = "Баланс бензовоза будет пересчитан. Действие необратимо.";
    let warning: string | undefined;

    if (isIssue) {
      const info = await fuelIssueDeleteInfo(e.id);
      if (!info.ok) { toast.error(info.error); return; }
      const who = [e.reg, e.driver].filter(Boolean).join(" · ") || "машина не определена";
      const files = [
        info.info.hasSignature ? "подпись водителя" : null,
        info.info.hasReceipt ? "фото чека" : null,
      ].filter(Boolean).join(" и ");
      description =
        `Выдача ${fmtLiters(Math.abs(e.liters ?? 0))} — ${who}. `
        + `Изменятся удержания ГСМ по договору, расход к нормативу и остаток бензовоза.`
        + (files ? ` Безвозвратно удалится ${files}.` : "");
      if (info.info.closingDocs.length) {
        warning = `Период уже закрыт: ${info.info.closingDocs.join(", ")}. Выпущенный документ разойдётся с базой.`;
      }
    }

    const ok = await confirm({
      title: isIssue ? "Удалить выдачу топлива?" : "Удалить операцию?",
      description,
      warning,
      confirmLabel: "Удалить",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await adminDeleteTankerEvent(e.kind, e.id);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Операция удалена");
      router.refresh();
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
        <div role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
          {done}{" "}
          <button className="min-h-11 px-2 underline" onClick={() => setDone(null)}>
            Понятно
          </button>
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
            <Label htmlFor="refill-receipt">Фото чека (необязательно)</Label>
            {/* sr-only, а не hidden: display:none убирает поле из фокуса и снять
                фото с клавиатуры нельзя. Тот же случай, что в выдаче топлива. */}
            <label
              htmlFor="refill-receipt"
              className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
            >
              {rFile ? "Заменить фото" : "Сделать фото"}
              <input id="refill-receipt" type="file" accept="image/*" capture="environment" className="sr-only"
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
      <section className="flex flex-col gap-2" aria-labelledby="history-label">
        <GroupLabel id="history-label">История операций</GroupLabel>
        <div className="flex flex-col divide-y rounded-lg border">
          {events.length === 0 ? (
            <EmptyState icon={Fuel} title="Операций пока нет" description="Приходы, выдачи и замеры появятся здесь." className="border-0 p-6" />
          ) : (
            events.map((e) => (
              <div key={`${e.kind}-${e.id}`} className="flex items-center gap-3 p-3">
                {e.kind === "refill" ? (
                  <ArrowUpRight className="size-5 text-success" />
                ) : e.kind === "issue" ? (
                  <ArrowDownRight className="size-5 text-warning" />
                ) : (
                  <Ruler className="size-5 text-info" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {e.kind === "refill" && `Приход ${fmtLiters(e.liters)}`}
                    {e.kind === "issue" && `Выдача ${fmtLiters(Math.abs(e.liters ?? 0))}`}
                    {e.kind === "measurement" &&
                      `Замер ${fmtLiters(e.measured)} (расчёт ${fmtLiters(e.calculated)})`}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {fmtDateTime(e.at)}
                    {e.kind === "issue" && (e.reg || e.driver)
                      ? ` · ${[e.reg, e.driver].filter(Boolean).join(" · ")}`
                      : ""}
                  </p>
                </div>
                {isAdmin && e.kind === "issue" ? (
                  <Link
                    // Дата — в поясе объекта: у выдачи после 19:00 UTC-дата на сутки раньше.
                    href={`/fleet/journals/fuel?vehicle=${e.vehicleId ?? ""}&period=custom&from=${aqtobeDate(e.at)}&to=${aqtobeDate(e.at)}`}
                    aria-label="Открыть в журнале ГСМ"
                    title="Открыть в журнале ГСМ — там видны одометр, чек и подпись"
                  >
                    <ExternalLink className="size-4 text-muted-foreground" />
                  </Link>
                ) : null}
                {isAdmin ? (
                  <button
                    aria-label="Удалить (админ)"
                    onClick={() => deleteEvent(e)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
      <OutboxList entries={queued} onRemove={dropQueued} />
      {confirmDialog}
    </div>
  );
}
