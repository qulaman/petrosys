"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Droplet, MapPin, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AttachmentLink } from "@/components/journals/attachment-link";
import { SignatureThumb, useSignedUrls } from "@/components/journals/signature-thumb";
import { downloadCsv } from "@/lib/journals/csv";
import { fmtDateTime, fmtInt, fmtLiters } from "@/lib/format";
import type { FuelJournalRow } from "@/lib/data/journals";
import { adminDeleteFuelIssue, adminUpdateFuelIssue } from "@/app/fleet/journals/admin-actions";

export function FuelJournal({
  rows,
  isAdmin = false,
  drivers = [],
  vehicles = [],
}: {
  rows: FuelJournalRow[];
  isAdmin?: boolean;
  drivers?: { id: string; full_name: string }[];
  vehicles?: { id: string; reg_number: string }[];
}) {
  const router = useRouter();
  const [shownCount, setShownCount] = useState(100);
  const shown = rows.slice(0, shownCount);
  const sigUrls = useSignedUrls("signatures", shown.map((r) => r.signature_path));
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<FuelJournalRow | null>(null);
  const [toDelete, setToDelete] = useState<FuelJournalRow | null>(null);
  const [form, setForm] = useState({ liters: "", odometer: "", driver_id: "", vehicle_id: "" });

  // Сводка по текущему фильтру.
  const total = rows.reduce((s, r) => s + r.liters, 0);
  const card = rows.reduce((s, r) => s + (r.source === "card" ? r.liters : 0), 0);
  const vehiclesCount = new Set(rows.map((r) => r.vehicle_id)).size;

  function openEdit(r: FuelJournalRow) {
    setForm({
      liters: String(r.liters),
      odometer: r.odometer == null ? "" : String(r.odometer),
      driver_id: r.driver_id,
      vehicle_id: r.vehicle_id,
    });
    setEditing(r);
  }

  function saveEdit() {
    if (!editing) return;
    const liters = parseFloat(form.liters);
    if (!(liters > 0)) { toast.error("Введите литры"); return; }
    start(async () => {
      const res = await adminUpdateFuelIssue({
        id: editing.id,
        liters,
        odometer: form.odometer ? parseFloat(form.odometer) : null,
        driver_id: form.driver_id,
        vehicle_id: form.vehicle_id,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Запись изменена");
      setEditing(null);
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    const row = toDelete;
    start(async () => {
      const res = await adminDeleteFuelIssue(row.id);
      setToDelete(null);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Запись удалена");
      router.refresh();
    });
  }

  function exportCsv() {
    downloadCsv(
      "журнал-гсм.csv",
      ["Время", "Машина", "Марка", "Водитель", "Литры", "Источник", "Одометр", "Выдал"],
      rows.map((r) => [
        fmtDateTime(r.at), r.reg, r.brand, r.driver, r.liters,
        `${r.source === "card" ? "Карта" : "Бензовоз"}: ${r.source_name}`, r.odometer, r.issuedBy,
      ]),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-md border px-2.5 py-1">Выдано <b className="tabular-nums">{fmtLiters(total)}</b></span>
          <span className="rounded-md border px-2.5 py-1 text-muted-foreground">карта <b className="tabular-nums">{fmtInt(card)}</b></span>
          <span className="rounded-md border px-2.5 py-1 text-muted-foreground">бензовоз <b className="tabular-nums">{fmtInt(total - card)}</b></span>
          <span className="rounded-md border px-2.5 py-1 text-muted-foreground">машин <b className="tabular-nums">{vehiclesCount}</b></span>
          <span className="rounded-md border px-2.5 py-1 text-muted-foreground">записей <b className="tabular-nums">{rows.length}</b></span>
        </div>
        <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv} disabled={!rows.length}>
          <Download className="size-4" /> CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Время</th>
              <th className="px-3 py-2 font-medium">Машина</th>
              <th className="px-3 py-2 font-medium">Водитель</th>
              <th className="px-3 py-2 font-medium text-right">Литры</th>
              <th className="px-3 py-2 font-medium">Источник</th>
              <th className="px-3 py-2 font-medium text-right">Одометр</th>
              <th className="px-3 py-2 font-medium">Выдал</th>
              <th className="px-3 py-2 font-medium">Чек</th>
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
                    {r.geo ? (
                      <a
                        href={`https://maps.google.com/?q=${r.geo.lat},${r.geo.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Точка выдачи на карте"
                      >
                        <MapPin className="size-3.5 text-muted-foreground hover:text-primary" />
                      </a>
                    ) : null}
                  </span>
                </td>
                <td className="px-3 py-2 font-medium">{r.reg}</td>
                <td className="px-3 py-2">{r.driver}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtLiters(r.liters)}</td>
                <td className="px-3 py-2">{r.source === "card" ? "Карта" : "Бензовоз"}: {r.source_name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.odometer ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.issuedBy}</td>
                <td className="px-3 py-2"><AttachmentLink bucket="receipts" path={r.receipt_path} label="Открыть" /></td>
                <td className="px-3 py-2"><SignatureThumb path={r.signature_path} urls={sigUrls} /></td>
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
                <EmptyState icon={Droplet} title="Нет записей за период" description="Измените период или фильтры выше." className="border-0 p-6" />
              </td></tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot className="border-t bg-muted/50 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={3}>Итого</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtLiters(total)}</td>
                <td className="px-3 py-2" colSpan={isAdmin ? 6 : 5} />
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

      {/* Правка (admin) */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Правка выдачи · {editing?.reg}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Подпись водителя была поставлена под исходными данными — правка администратора меняет учётные цифры
            и попадает в журнал изменений.
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
              <Label>Литры</Label>
              <Input inputMode="decimal" value={form.liters} onChange={(e) => setForm((s) => ({ ...s, liters: e.target.value.replace(/[^\d.]/g, "") }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Одометр / моточасы</Label>
              <Input inputMode="decimal" value={form.odometer} onChange={(e) => setForm((s) => ({ ...s, odometer: e.target.value.replace(/[^\d.]/g, "") }))} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Водитель</Label>
              <select value={form.driver_id} onChange={(e) => setForm((s) => ({ ...s, driver_id: e.target.value }))} className="h-10 rounded-md border bg-background px-3 text-sm">
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Отмена</Button>
            <Button onClick={saveEdit} loading={pending}>{pending ? "Сохранение…" : "Сохранить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Удаление (admin) */}
      <Dialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Удалить выдачу?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {toDelete ? `${toDelete.reg} · ${fmtLiters(toDelete.liters)} · ${fmtDateTime(toDelete.at)}. ` : ""}
            Запись, чек и подпись перестанут учитываться. Действие необратимо.
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
