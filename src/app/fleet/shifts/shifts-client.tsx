"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CopyPlus, FilePlus2, Lock, PenLine, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignaturePad } from "@/components/field/signature-pad";
import { VehiclePicker } from "@/components/field/vehicle-picker";
import { useNavProgress } from "@/components/nav-progress";
import { OutboxList } from "@/components/field/outbox-list";
import { useOutbox, type SubmitResult } from "@/lib/outbox/use-outbox";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { uploadSignature } from "@/lib/storage/upload";
import { driverGroups, driverPoolFor, vehicleTypeLabel } from "@/lib/domain";
import { devError } from "@/lib/dev-log";
import type { JournalLine, ShiftJournalData } from "@/lib/data/shifts";
import { addLine, closeJournal, createJournal, removeLine, reopenJournal, updateJournal, updateLine } from "./actions";
import { TIME_ZONE } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  draft: "Этап 1 · Перечень техники",
  filling: "Этап 2 · Часы и подписи работников",
  closed: "Журнал закрыт",
};

export function ShiftsClient({ data, isAdmin = false }: { data: ShiftJournalData; isAdmin?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { journal, lines, vehicles, drivers, workTypes, lastDriverByVehicle, previous } = data;

  const [pending, start] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [signLine, setSignLine] = useState<JournalLine | null>(null);
  const [signItr, setSignItr] = useState(false);
  const [hoursDraft, setHoursDraft] = useState<Record<string, string>>({});
  const { confirm, confirmDialog } = useConfirm();

  // Часы коммитятся по onBlur — при обрыве связи правка раньше терялась,
  // оставляя только тост. Теперь она ждёт связь в очереди.
  const submitHours = useCallback(
    (p: { line_id: string; hours: number }): Promise<SubmitResult> =>
      updateLine(p).then((r) => (r.ok ? { ok: true } : { ok: false, error: r.error })),
    [],
  );
  const {
    entries: queuedHours,
    add: queueHours,
    remove: dropQueuedHours,
  } = useOutbox<{ line_id: string; hours: number }>("shift_hours", submitHours, () => router.refresh());

  const vehById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const drvById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const usedVehicleIds = new Set(lines.map((l) => l.vehicle_id));
  const availableVehicles = vehicles.filter((v) => !usedVehicleIds.has(v.id));

  const signedCount = lines.filter((l) => l.driver_signature_url).length;
  const allSigned = lines.length > 0 && signedCount === lines.length;
  const isClosed = journal?.status === "closed";
  const isDraft = journal?.status === "draft";

  const nav = useNavProgress();
  function setParams(date: string, shift: string) {
    nav.push(`${pathname}?date=${date}&shift=${shift}`);
  }

  function driverFor(vehicleId: string): string | null {
    // приоритет: штатный водитель смены из справочника АВР → последний по машине → пул
    const v = vehById.get(vehicleId);
    const staff = data.shift === "night" ? v?.night_driver_id : v?.day_driver_id;
    if (staff && drvById.has(staff)) return staff;
    const last = lastDriverByVehicle[vehicleId];
    if (last && drvById.has(last)) return last;
    const pool = driverPoolFor(v, drivers);
    return pool[0]?.id ?? drivers[0]?.id ?? null;
  }

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) { toast.error(res.error ?? "Ошибка"); return; }
      if (okMsg) toast.success(okMsg);
      router.refresh();
    });
  }

  // ---------------------------------------------------------------------------
  // Нет журнала — выбор способа создания (этап 1)
  // ---------------------------------------------------------------------------
  if (!journal) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <ShiftPicker date={data.date} shift={data.shift} onChange={setParams} />

        <p className="text-sm text-muted-foreground">
          Журнала на эту смену ещё нет. Создайте перечень техники на линии:
        </p>

        {previous ? (
          <Button
            className="h-20 justify-start gap-3 text-left"
            loading={pending}
            onClick={() =>
              act(
                () =>
                  createJournal({
                    shift_date: data.date,
                    shift_type: data.shift,
                    work_type_id: null,
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
                {previous.shift_date} · {previous.shift_type === "day" ? "день" : "ночь"} · машин: {previous.lineCount}
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
                createJournal({
                  shift_date: data.date,
                  shift_type: data.shift,
                  work_type_id: null,
                  inherit_from: null,
                }),
              "Журнал создан",
            )
          }
        >
          <FilePlus2 className="size-6 shrink-0" />
          <span>
            <span className="block font-semibold">С чистого листа</span>
            <span className="block text-xs text-muted-foreground">Набор перечня вручную</span>
          </span>
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Журнал существует — этапы 1/2/3
  // ---------------------------------------------------------------------------
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-8">
      <ShiftPicker date={data.date} shift={data.shift} onChange={setParams} />

      {/* Статус-плашка */}
      <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm font-medium ${isClosed ? "border-success/40 bg-success/10" : ""}`}>
        {isClosed ? <Lock className="size-4 text-success" /> : <PenLine className="size-4 text-primary" />}
        {STATUS_LABEL[journal.status]}
        {journal.status === "filling" ? (
          <span className="ml-auto text-xs text-muted-foreground">подписано {signedCount}/{lines.length}</span>
        ) : null}
      </div>

      {/* Вид работ */}
      <div className="flex flex-col gap-1.5">
        <Label>Вид работ</Label>
        <select
          value={journal.work_type_id ?? ""}
          disabled={isClosed || pending}
          onChange={(e) => act(() => updateJournal(journal.id, { work_type_id: e.target.value || null }))}
          className="h-12 rounded-md border bg-background px-3 text-base disabled:opacity-60"
        >
          <option value="">—</option>
          {workTypes.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>

      {/* Строки журнала */}
      <div className="flex flex-col gap-2">
        <Label>Техника на линии ({lines.length})</Label>
        {lines.map((l) => {
          const v = vehById.get(l.vehicle_id);
          const signed = !!l.driver_signature_url;
          return (
            <div key={l.id} className={`rounded-lg border p-3 ${signed ? "border-success bg-success/10" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-tight">{v?.reg_number ?? "—"}</span>
                <span className="text-xs text-muted-foreground">{v ? vehicleTypeLabel(v.vehicle_type) : ""}</span>
                {signed ? (
                  <span className="ml-auto flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-xs font-semibold text-white">
                    <Check className="size-3.5" /> подписано
                  </span>
                ) : null}
                {!isClosed && !signed ? (
                  <button
                    className="ml-auto flex size-11 items-center justify-center -my-2 -mr-2"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Убрать машину из журнала?",
                        description: "Строка с часами и подписью работника будет удалена из этой смены.",
                        confirmLabel: "Убрать",
                        destructive: true,
                      });
                      if (ok) act(() => removeLine(l.id), "Строка убрана");
                    }}
                    aria-label="Убрать машину из журнала"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </button>
                ) : null}
              </div>

              <div className="mt-2 grid grid-cols-[6rem_1fr] gap-2">
                <Input
                  inputMode="decimal"
                  disabled={isClosed}
                  value={hoursDraft[l.id] ?? String(l.hours)}
                  onChange={(e) => setHoursDraft((s) => ({ ...s, [l.id]: e.target.value.replace(/[^\d.]/g, "") }))}
                  onBlur={() => {
                    const raw = hoursDraft[l.id];
                    if (raw == null || raw === String(l.hours)) return;
                    const h = parseFloat(raw);
                    if (!(h > 0 && h <= 24)) { toast.error("Часы: 0–24"); setHoursDraft((s) => ({ ...s, [l.id]: String(l.hours) })); return; }
                    // id привязан к строке: повторная правка заменяет предыдущую в очереди.
                    void queueHours(
                      { line_id: l.id, hours: h },
                      `${vehById.get(l.vehicle_id)?.reg_number ?? "машина"} · ${h} ч`,
                      `hours-${l.id}`,
                    );
                    toast.success(signed ? "Часы изменены — нужна новая подпись" : "Часы изменены");
                  }}
                  className={`h-11 text-center text-lg font-semibold ${signed ? "border-success/60 text-success" : ""}`}
                />
                <select
                  value={l.driver_id}
                  disabled={isClosed}
                  onChange={(e) => act(() => updateLine({ line_id: l.id, driver_id: e.target.value }), signed ? "Водитель изменён — нужна новая подпись" : undefined)}
                  className="h-11 rounded-md border bg-background px-2 text-sm disabled:opacity-60"
                >
                  {(() => {
                    // Сквозной подход: сначала «свои» водители машины (штатные/ИП), затем остальные.
                    const { primary, rest } = driverGroups(vehById.get(l.vehicle_id), drivers);
                    if (!primary.length)
                      return rest.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>);
                    return (
                      <>
                        <optgroup label="Водители машины">
                          {primary.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                        </optgroup>
                        <optgroup label="Остальные">
                          {rest.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                        </optgroup>
                      </>
                    );
                  })()}
                </select>
              </div>

              {!isDraft && !isClosed && !signed ? (
                <Button variant="outline" className="mt-2 h-11 w-full" disabled={pending} onClick={() => setSignLine(l)}>
                  <PenLine className="size-4" /> Подпись работника
                </Button>
              ) : null}
            </div>
          );
        })}
        {lines.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Перечень пуст. Добавьте технику.
          </p>
        ) : null}
      </div>

      {/* Добавление техники (draft и filling) */}
      {!isClosed ? (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" className="h-12" onClick={() => setAddOpen((v) => !v)}>
            <Plus className="size-5" /> Добавить технику
          </Button>
          {addOpen ? (
            <VehiclePicker
              vehicles={availableVehicles}
              disabled={pending}
              stickyFilters
              noVehiclesText="Вся техника уже в перечне"
              onSelect={(v) => {
                const driverId = driverFor(v.id);
                if (!driverId) { toast.error("Нет активных водителей"); return; }
                act(() => addLine({ journal_id: journal.id, vehicle_id: v.id, driver_id: driverId }), `${v.reg_number} добавлена`);
              }}
            />
          ) : null}
        </div>
      ) : null}

      {/* Кнопка этапа */}
      {isDraft ? (
        <Button
          className="h-14 text-lg"
          loading={pending}
          disabled={lines.length === 0}
          onClick={() => act(() => updateJournal(journal.id, { status: "filling" }), "Перечень зафиксирован — заполняйте часы")}
        >
          Перечень готов → к часам и подписям
        </Button>
      ) : null}

      {journal.status === "filling" ? (
        <Button className="h-14 text-lg" loading={pending} disabled={!allSigned} onClick={() => setSignItr(true)}>
          {allSigned ? "Закрыть журнал (подпись мастера)" : `Ожидают подписи: ${lines.length - signedCount}`}
        </Button>
      ) : null}

      {isClosed ? (
        <>
          <p className="text-center text-sm text-muted-foreground">
            Журнал закрыт{journal.closed_at ? ` · ${new Date(journal.closed_at).toLocaleString("ru-RU", { timeZone: TIME_ZONE })}` : ""}. Изменения недоступны.
          </p>
          {isAdmin ? (
            <Button
              variant="outline"
              className="h-12"
              loading={pending}
              onClick={async () => {
                const ok = await confirm({
                  title: "Переоткрыть журнал?",
                  description: "Подпись мастера будет снята — после правок журнал нужно закрыть и подписать заново.",
                  confirmLabel: "Переоткрыть",
                });
                if (ok) act(() => reopenJournal(journal.id), "Журнал переоткрыт — подпись мастера снята");
              }}
            >
              Переоткрыть журнал (администратор)
            </Button>
          ) : null}
        </>
      ) : null}

      {/* Подпись работника */}
      {signLine ? (
        <SignaturePad
          signerName={drvById.get(signLine.driver_id)?.full_name ?? "Работник"}
          onDone={async (dataUrl) => {
            const line = signLine;
            setSignLine(null);
            try {
              const path = await uploadSignature(data.orgId, dataUrl);
              act(() => updateLine({ line_id: line.id, signature_path: path }), "Подпись сохранена");
            } catch (e) {
              devError("sign-line", e);
              toast.error("Не удалось загрузить подпись");
            }
          }}
          onCancel={() => setSignLine(null)}
        />
      ) : null}

      {/* Подпись мастера (закрытие) */}
      {signItr ? (
        <SignaturePad
          signerName="Мастер (ИТР) — закрытие журнала"
          onDone={async (dataUrl) => {
            setSignItr(false);
            try {
              const path = await uploadSignature(data.orgId, dataUrl);
              act(() => closeJournal(journal.id, path), "Журнал закрыт");
            } catch (e) {
              devError("sign-itr", e);
              toast.error("Не удалось загрузить подпись");
            }
          }}
          onCancel={() => setSignItr(false)}
        />
      ) : null}
      <OutboxList entries={queuedHours} onRemove={dropQueuedHours} />
      {confirmDialog}
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
        <Label htmlFor="jr-date">Дата</Label>
        <Input id="jr-date" type="date" value={date} onChange={(e) => onChange(e.target.value, shift)} className="h-12" />
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
