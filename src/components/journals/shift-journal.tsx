"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardList, Download, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { SignatureThumb, useSignedUrls } from "@/components/journals/signature-thumb";
import { downloadCsv } from "@/lib/journals/csv";
import { fmtInt } from "@/lib/format";
import type { ShiftJournalRow } from "@/lib/data/journals";
import { adminDeleteShiftRecord, adminUpdateShiftRecord } from "@/app/fleet/journals/admin-actions";

export function ShiftJournal({
  rows,
  isAdmin = false,
  drivers = [],
  vehicles = [],
  workTypes = [],
}: {
  rows: ShiftJournalRow[];
  isAdmin?: boolean;
  drivers?: { id: string; full_name: string }[];
  vehicles?: { id: string; reg_number: string }[];
  workTypes?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [shownCount, setShownCount] = useState(100);
  const shown = rows.slice(0, shownCount);
  const sigUrls = useSignedUrls(
    "signatures",
    shown.flatMap((r) => [r.driver_signature_path, r.itr_signature_path]),
  );
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<ShiftJournalRow | null>(null);
  const [toDelete, setToDelete] = useState<ShiftJournalRow | null>(null);
  const [form, setForm] = useState({ hours: "", driver_id: "", work_type_id: "", vehicle_id: "" });

  // Сводка по текущему фильтру.
  const totalHours = Math.round(rows.reduce((s, r) => s + r.hours, 0) * 10) / 10;
  const inMoneyCount = rows.filter((r) => r.inMoney).length;
  const backdatedCount = rows.filter((r) => r.backdated).length;

  function openEdit(r: ShiftJournalRow) {
    setForm({
      hours: String(r.hours),
      driver_id: r.driver_id,
      work_type_id: r.work_type_id ?? "",
      vehicle_id: r.vehicle_id,
    });
    setEditing(r);
  }

  function saveEdit() {
    if (!editing) return;
    const hours = parseFloat(form.hours);
    if (!(hours > 0 && hours <= 24)) { toast.error("Часы: от 0 до 24"); return; }
    start(async () => {
      const res = await adminUpdateShiftRecord({
        id: editing.id,
        hours,
        driver_id: form.driver_id,
        work_type_id: form.work_type_id || null,
        vehicle_id: form.vehicle_id,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Смена изменена");
      setEditing(null);
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    const row = toDelete;
    start(async () => {
      const res = await adminDeleteShiftRecord(row.id);
      setToDelete(null);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Запись смены удалена");
      router.refresh();
    });
  }

  function exportCsv() {
    downloadCsv(
      "журнал-смен.csv",
      ["Дата", "Смена", "Машина", "Водитель", "Часы", "Вид работ", "Статус", "Внёс"],
      rows.map((r) => [
        r.date, r.shift === "day" ? "День" : "Ночь", r.reg, r.driver, r.hours, r.work_type,
        r.inMoney ? "в расчёте" : "черновик", r.itrName,
      ]),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-md border px-2.5 py-1">Часов <b className="tabular-nums">{fmtInt(totalHours)}</b></span>
          <span className="rounded-md border px-2.5 py-1 text-muted-foreground">смен <b className="tabular-nums">{rows.length}</b></span>
          <span className="rounded-md border px-2.5 py-1 text-muted-foreground">
            в расчёте <b className="tabular-nums">{rows.length ? Math.round((inMoneyCount / rows.length) * 100) : 0}%</b>
          </span>
          {backdatedCount > 0 ? (
            <span className="rounded-md border border-amber-500/40 px-2.5 py-1 text-amber-700 dark:text-amber-500">
              задним числом <b className="tabular-nums">{backdatedCount}</b>
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
              <th className="px-3 py-2 font-medium">Дата</th>
              <th className="px-3 py-2 font-medium">Смена</th>
              <th className="px-3 py-2 font-medium">Машина</th>
              <th className="px-3 py-2 font-medium">Водитель</th>
              <th className="px-3 py-2 font-medium text-right">Часы</th>
              <th className="px-3 py-2 font-medium">Вид работ</th>
              <th className="px-3 py-2 font-medium" title="Деньги считают только смены закрытых журналов">Статус</th>
              <th className="px-3 py-2 font-medium">Внёс</th>
              <th className="px-3 py-2 font-medium">Подписи</th>
              {isAdmin ? <th className="px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => (
              <tr key={r.id} className="hover:bg-accent/40">
                <td className="whitespace-nowrap px-3 py-2">
                  {r.date}
                  {r.backdated ? (
                    <span
                      className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-500"
                      title={`Внесена ${r.createdAt.slice(0, 10)} — позже даты смены`}
                    >
                      задним числом
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{r.shift === "day" ? "День" : "Ночь"}</td>
                <td className="px-3 py-2 font-medium">{r.reg}</td>
                <td className="px-3 py-2">{r.driver}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.hours}</td>
                <td className="px-3 py-2">{r.work_type}</td>
                <td className="px-3 py-2">
                  <StatusBadge tone={r.inMoney ? "green" : "amber"}>
                    {r.inMoney ? "в расчёте" : "черновик"}
                  </StatusBadge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.itrName}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <SignatureThumb path={r.driver_signature_path} urls={sigUrls} title="Подпись водителя" />
                    <SignatureThumb path={r.itr_signature_path} urls={sigUrls} title="Подпись мастера" />
                  </div>
                </td>
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
              <tr><td colSpan={isAdmin ? 10 : 9}>
                <EmptyState icon={ClipboardList} title="Нет смен за период" description="Измените период или фильтры выше." className="border-0 p-6" />
              </td></tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot className="border-t bg-muted/50 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={4}>Итого</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(totalHours)}</td>
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

      {/* Правка (admin): закрытый журнал сперва переоткрывается в Табеле */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Правка смены · {editing?.reg} · {editing?.date}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Изменение часов или водителя сбрасывает подпись работника — она стояла под другими данными.
            Смены закрытых журналов сначала переоткрываются на экране «Табель».
          </p>
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
              <Label>Часы</Label>
              <Input inputMode="decimal" value={form.hours} onChange={(e) => setForm((s) => ({ ...s, hours: e.target.value.replace(/[^\d.]/g, "") }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Водитель</Label>
              <select value={form.driver_id} onChange={(e) => setForm((s) => ({ ...s, driver_id: e.target.value }))} className="h-10 rounded-md border bg-background px-3 text-sm">
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Вид работ</Label>
              <select value={form.work_type_id} onChange={(e) => setForm((s) => ({ ...s, work_type_id: e.target.value }))} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="">—</option>
                {workTypes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
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
          <DialogHeader><DialogTitle>Удалить запись смены?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {toDelete ? `${toDelete.reg} · ${toDelete.date} (${toDelete.shift === "day" ? "день" : "ночь"}) · ${toDelete.hours} ч. ` : ""}
            Часы перестанут учитываться в начислениях. Действие необратимо.
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
