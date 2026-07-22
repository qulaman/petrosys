"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Pencil, Timer, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { downloadCsv } from "@/lib/journals/csv";
import { fmtDateTime, fmtInt } from "@/lib/format";
import type { TripJournalRow } from "@/lib/data/journals";
import { adminDeleteTrip, adminUpdateTrip } from "@/app/fleet/journals/admin-actions";

export function TripJournal({
  rows,
  isAdmin = false,
  drivers = [],
  routes = [],
  vehicles = [],
}: {
  rows: TripJournalRow[];
  isAdmin?: boolean;
  drivers?: { id: string; full_name: string }[];
  routes?: { id: string; name: string }[];
  vehicles?: { id: string; reg_number: string }[];
}) {
  const router = useRouter();
  const [shownCount, setShownCount] = useState(100);
  const shown = rows.slice(0, shownCount);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<TripJournalRow | null>(null);
  const [toDelete, setToDelete] = useState<TripJournalRow | null>(null);
  const [form, setForm] = useState({ driver_id: "", route_id: "", vehicle_id: "" });

  // Сводка по текущему фильтру.
  const vehiclesCount = new Set(rows.map((r) => r.vehicle_id)).size;
  const draftCount = rows.filter((r) => r.draft).length;

  function openEdit(r: TripJournalRow) {
    setForm({ driver_id: r.driver_id, route_id: r.route_id, vehicle_id: r.vehicle_id });
    setEditing(r);
  }

  function saveEdit() {
    if (!editing) return;
    start(async () => {
      const res = await adminUpdateTrip({ id: editing.id, driver_id: form.driver_id, route_id: form.route_id, vehicle_id: form.vehicle_id });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Рейс изменён");
      setEditing(null);
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    const row = toDelete;
    start(async () => {
      const res = await adminDeleteTrip(row.id);
      setToDelete(null);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Рейс удалён");
      router.refresh();
    });
  }

  function exportCsv() {
    downloadCsv(
      "журнал-рейсов.csv",
      ["Время", "Машина", "Водитель", "Маршрут", "Подпись", "Записал", "Как", "Статус"],
      rows.map((r) => [
        fmtDateTime(r.at), r.reg, r.driver, r.route, r.has_signature ? "да" : "нет",
        r.recordedBy, r.sourceLabel, r.draft ? "черновик" : "учтён",
      ]),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-md border px-2.5 py-1">Рейсов <b className="tabular-nums">{fmtInt(rows.length)}</b></span>
          <span className="rounded-md border px-2.5 py-1 text-muted-foreground">машин <b className="tabular-nums">{vehiclesCount}</b></span>
          {draftCount > 0 ? (
            <span className="rounded-md border border-amber-500/40 px-2.5 py-1 text-amber-700 dark:text-amber-500">
              черновых <b className="tabular-nums">{draftCount}</b>
            </span>
          ) : null}
        </div>
        <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv} disabled={!rows.length}>
          <Download className="size-4" /> CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium" title="Момент фиксации рейса учётчиком (тап на телефоне)">Время</th>
              <th className="px-3 py-2 font-medium">Машина</th>
              <th className="px-3 py-2 font-medium">Водитель</th>
              <th className="px-3 py-2 font-medium">Маршрут</th>
              <th className="px-3 py-2 font-medium">Записал</th>
              <th className="px-3 py-2 font-medium">Подпись</th>
              {isAdmin ? <th className="px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => (
              <tr key={r.id} className="hover:bg-accent/40">
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    {fmtDateTime(r.at)}
                    {r.delayed ? (
                      <Timer
                        className="size-3.5 text-amber-600"
                        aria-label="Отправлен позже"
                      />
                    ) : null}
                  </span>
                  {r.delayed ? (
                    <span className="sr-only">отправлен позже</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 font-medium">
                  {r.reg}
                  {r.draft ? (
                    <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-normal text-amber-700 dark:text-amber-500">
                      черновик
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{r.driver}</td>
                <td className="px-3 py-2">{r.route}</td>
                <td className="px-3 py-2 text-muted-foreground" title={`Источник: ${r.sourceLabel}${r.delayed ? ` · доставлен ${fmtDateTime(r.sentAt)}` : ""}`}>
                  {r.recordedBy}
                </td>
                <td className="px-3 py-2">{r.has_signature ? "да" : "—"}</td>
                {isAdmin ? (
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Pencil className="size-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setToDelete(r)}><Trash2 className="size-4 text-destructive" /></Button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={isAdmin ? 7 : 6}>
                <EmptyState icon={Truck} title="Нет рейсов за период" description="Измените период или фильтры выше." className="border-0 p-6" />
              </td></tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot className="border-t bg-muted/50 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={2}>Итого рейсов: {fmtInt(rows.length)}</td>
                <td className="px-3 py-2" colSpan={isAdmin ? 5 : 4} />
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
        ⏱ у времени — рейс записан офлайн и доставлен на сервер позже (время показано фактическое, по тапу учётчика).
      </p>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Правка рейса · {editing?.reg}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Машина</Label>
              <SearchSelect
                value={form.vehicle_id}
                onChange={(v) => setForm((s) => ({ ...s, vehicle_id: v || s.vehicle_id }))}
                options={vehicles.map((v) => ({ value: v.id, label: v.reg_number }))}
                allowEmpty={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Водитель</Label>
              <select value={form.driver_id} onChange={(e) => setForm((s) => ({ ...s, driver_id: e.target.value }))} className="h-10 rounded-md border bg-background px-3 text-sm">
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Маршрут</Label>
              <select value={form.route_id} onChange={(e) => setForm((s) => ({ ...s, route_id: e.target.value }))} className="h-10 rounded-md border bg-background px-3 text-sm">
                {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Отмена</Button>
            <Button onClick={saveEdit} loading={pending}>{pending ? "Сохранение…" : "Сохранить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Удалить рейс?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {toDelete ? `${toDelete.reg} · ${fmtDateTime(toDelete.at)}. ` : ""}
            Рейс перестанет учитываться в начислениях. Действие необратимо.
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
