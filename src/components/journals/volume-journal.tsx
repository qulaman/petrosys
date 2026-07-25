"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Download, Mountain, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { downloadCsv } from "@/lib/journals/csv";
import { fmtInt } from "@/lib/format";
import { FLOW_LABELS, type Flow } from "@/lib/forecast";
import type { VolumeJournalRow } from "@/lib/data/journals";
import { createProductionFact, deleteProductionFact, updateProductionFact } from "@/app/fleet/volume/actions";

const SHIFT_LABELS: Record<string, string> = { day: "День", night: "Ночь" };
const STATUS_LABELS: Record<string, string> = {
  work: "Работа",
  downtime_weather: "Простой — погода",
  downtime_tech: "Простой — техника",
};

const selectCls =
  "h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

const dmy = (d: string) => d.split("-").reverse().join(".");
const shiftText = (s: string | null) => (s ? SHIFT_LABELS[s] : "За сутки");
const flowText = (f: string | null) => (f ? (FLOW_LABELS[f as Flow] ?? f) : "—");

interface FormState {
  work_date: string;
  shift_type: string; // "" — за сутки
  flow: string;
  day_status: string;
  trips: string;
  volume: string;
  note: string;
}

const emptyForm = (today: string): FormState => ({
  work_date: today,
  shift_type: "",
  flow: "pit",
  day_status: "work",
  trips: "",
  volume: "",
  note: "",
});

/**
 * Журнал сводок объёма: период/смена/поток фильтруются выше, здесь — таблица,
 * итоги, выгрузка и полный набор правок (добавить/изменить/удалить) по сменам.
 */
export function VolumeJournal({
  rows,
  today,
  canEdit = false,
  canManage = false,
}: {
  rows: VolumeJournalRow[];
  today: string;
  /** Правка записей — офис/админ. */
  canEdit?: boolean;
  /** Добавление и удаление — ИТР/офис/админ. */
  canManage?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shownCount, setShownCount] = useState(100);
  const [editing, setEditing] = useState<VolumeJournalRow | "new" | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(today));
  const [toDelete, setToDelete] = useState<VolumeJournalRow | null>(null);

  const shown = rows.slice(0, shownCount);
  const hasActions = canEdit || canManage;
  const cols = 9 + (hasActions ? 1 : 0);

  // Сводка по текущему фильтру.
  const totalVolume = rows.reduce((a, r) => a + (r.volume_m3 ?? 0), 0);
  const totalTrips = rows.reduce((a, r) => a + (r.trips_count ?? 0), 0);
  const days = new Set(rows.map((r) => r.work_date)).size;
  const downtime = rows.filter((r) => r.day_status !== "work").length;
  const conflicts = rows.filter((r) => r.conflict).length;
  const m3PerTrip = totalTrips > 0 ? Math.round((totalVolume / totalTrips) * 10) / 10 : null;

  function openNew() {
    setForm(emptyForm(today));
    setEditing("new");
  }

  function openEdit(r: VolumeJournalRow) {
    setForm({
      work_date: r.work_date,
      shift_type: r.shift_type ?? "",
      flow: r.flow ?? "pit",
      day_status: r.day_status,
      trips: r.trips_count != null ? String(r.trips_count) : "",
      volume: r.volume_m3 != null ? String(r.volume_m3) : "",
      note: r.note ?? "",
    });
    setEditing(r);
  }

  function save() {
    const payload = {
      work_date: form.work_date,
      shift_type: form.shift_type ? (form.shift_type as "day" | "night") : null,
      flow: form.day_status === "work" ? (form.flow as Flow) : null,
      trips_count: form.trips ? parseInt(form.trips, 10) : null,
      volume_m3: form.volume ? parseFloat(form.volume.replace(",", ".")) : null,
      day_status: form.day_status,
      note: form.note || null,
    };
    const row = editing;
    start(async () => {
      const res =
        row === "new" || row === null
          ? await createProductionFact(payload)
          : await updateProductionFact({ ...payload, id: row.id });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(row === "new" ? "Сводка добавлена" : "Сводка изменена");
      setEditing(null);
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    const row = toDelete;
    start(async () => {
      const res = await deleteProductionFact(row.id);
      setToDelete(null);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Сводка удалена");
      router.refresh();
    });
  }

  function exportCsv() {
    downloadCsv(
      "журнал-объёма.csv",
      ["Дата", "Смена", "Поток", "Статус дня", "Рейсов", "Объём, м³", "Примечание", "Внёс"],
      rows.map((r) => [
        dmy(r.work_date),
        shiftText(r.shift_type),
        flowText(r.flow),
        STATUS_LABELS[r.day_status] ?? r.day_status,
        r.trips_count ?? "",
        r.volume_m3 ?? "",
        r.note ?? "",
        r.enteredBy,
      ]),
    );
  }

  const work = form.day_status === "work";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-md border px-2.5 py-1">
            Объём <b className="tabular-nums">{fmtInt(Math.round(totalVolume))}</b> м³
          </span>
          <span className="rounded-md border px-2.5 py-1 text-muted-foreground">
            записей <b className="tabular-nums">{fmtInt(rows.length)}</b> · дней <b className="tabular-nums">{days}</b>
          </span>
          {m3PerTrip ? (
            <span className="rounded-md border px-2.5 py-1 text-muted-foreground">
              м³/рейс <b className="tabular-nums">{m3PerTrip}</b>
            </span>
          ) : null}
          {downtime > 0 ? (
            <span className="rounded-md border px-2.5 py-1 text-muted-foreground">
              простоев <b className="tabular-nums">{downtime}</b>
            </span>
          ) : null}
          {conflicts > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 px-2.5 py-1 text-warning">
              <AlertTriangle className="size-3.5" /> двойной счёт: <b className="tabular-nums">{conflicts}</b>
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <Download className="size-4" /> CSV
          </Button>
          {canManage ? (
            <Button size="sm" onClick={openNew}>
              <Plus className="size-4" /> Добавить сводку
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Дата</th>
              <th className="px-3 py-2 font-medium">Смена</th>
              <th className="px-3 py-2 font-medium">Поток</th>
              <th className="px-3 py-2 font-medium">Статус дня</th>
              <th className="px-3 py-2 text-right font-medium">Рейсов</th>
              <th className="px-3 py-2 text-right font-medium">Объём, м³</th>
              <th className="px-3 py-2 text-right font-medium">м³/рейс</th>
              <th className="px-3 py-2 font-medium">Примечание</th>
              <th className="px-3 py-2 font-medium">Внёс</th>
              {hasActions ? <th className="px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => (
              <tr key={r.id} className="hover:bg-accent/40">
                <td className="whitespace-nowrap px-3 py-2 font-medium">{dmy(r.work_date)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {shiftText(r.shift_type)}
                  {r.conflict ? (
                    <span
                      className="ml-1.5 inline-flex items-center rounded bg-warning/15 px-1.5 py-0.5 text-xs text-warning"
                      title="За эту дату и поток есть и суточная, и сменные записи — прогноз сложит их вместе"
                    >
                      двойной счёт
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{flowText(r.flow)}</td>
                <td className="px-3 py-2">
                  {r.day_status === "work" ? (
                    <span className="text-muted-foreground">работа</span>
                  ) : (
                    <span className="text-warning">{STATUS_LABELS[r.day_status] ?? r.day_status}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.trips_count ?? "—"}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {r.volume_m3 != null ? fmtInt(Math.round(r.volume_m3)) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {r.trips_count && r.volume_m3 ? Math.round((r.volume_m3 / r.trips_count) * 10) / 10 : "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.note ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.enteredBy}</td>
                {hasActions ? (
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {canEdit ? (
                        <Button variant="ghost" size="sm" aria-label="Изменить" onClick={() => openEdit(r)}>
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {canManage ? (
                        <Button variant="ghost" size="sm" aria-label="Удалить" onClick={() => setToDelete(r)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={cols}>
                <EmptyState
                  icon={Mountain}
                  title="Нет сводок за период"
                  description="Измените период или фильтры выше — либо добавьте сводку."
                  className="border-0 p-6"
                />
              </td></tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot className="border-t bg-muted/50 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={4}>Итого за период</td>
                <td className="px-3 py-2 text-right tabular-nums">{totalTrips ? fmtInt(totalTrips) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(Math.round(totalVolume))}</td>
                <td className="px-3 py-2" colSpan={cols - 6} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {rows.length > shownCount ? (
        <Button variant="outline" size="sm" className="self-center" onClick={() => setShownCount((n) => n + 200)}>
          Показать ещё ({rows.length - shownCount})
        </Button>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Сводки — источник факта для прогноза объёма: правка и удаление сразу меняют вкладку «Объём» на дашборде.
        За дату можно вести либо одну запись «за сутки», либо записи по сменам — но не то и другое сразу по одному потоку.
      </p>

      {/* Добавление и правка — одна форма */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Новая сводка объёма" : "Правка сводки"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vj-date">Дата</Label>
              <Input
                id="vj-date"
                type="date"
                value={form.work_date}
                onChange={(e) => setForm((s) => ({ ...s, work_date: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Смена</Label>
              <select
                className={selectCls}
                value={form.shift_type}
                onChange={(e) => setForm((s) => ({ ...s, shift_type: e.target.value }))}
              >
                <option value="">За сутки</option>
                <option value="day">День</option>
                <option value="night">Ночь</option>
              </select>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Статус дня</Label>
              <select
                className={selectCls}
                value={form.day_status}
                onChange={(e) => setForm((s) => ({ ...s, day_status: e.target.value }))}
              >
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {work ? (
              <>
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label>Поток</Label>
                  <select
                    className={selectCls}
                    value={form.flow}
                    onChange={(e) => setForm((s) => ({ ...s, flow: e.target.value }))}
                  >
                    {Object.entries(FLOW_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="vj-trips">Рейсов</Label>
                  <Input
                    id="vj-trips"
                    inputMode="numeric"
                    placeholder="151"
                    value={form.trips}
                    onChange={(e) => setForm((s) => ({ ...s, trips: e.target.value.replace(/\D/g, "") }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="vj-volume">Объём, м³</Label>
                  <Input
                    id="vj-volume"
                    inputMode="decimal"
                    placeholder="2869"
                    value={form.volume}
                    onChange={(e) => setForm((s) => ({ ...s, volume: e.target.value.replace(/[^\d.,]/g, "") }))}
                  />
                </div>
              </>
            ) : null}
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="vj-note">Примечание</Label>
              <Input
                id="vj-note"
                value={form.note}
                placeholder="дождь до обеда / +1 бульдозер"
                onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Отмена</Button>
            <Button onClick={save} loading={pending}>{pending ? "Сохранение…" : "Сохранить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Удалить сводку?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {toDelete
              ? `${dmy(toDelete.work_date)} · ${shiftText(toDelete.shift_type)} · ${flowText(toDelete.flow)}`
              : ""}
            {toDelete?.volume_m3 != null ? ` · ${fmtInt(Math.round(toDelete.volume_m3))} м³` : ""}.
            Объём перестанет учитываться в прогнозе. Действие необратимо.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>Отмена</Button>
            <Button variant="destructive" onClick={confirmDelete} loading={pending}>Удалить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
