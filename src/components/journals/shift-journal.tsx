"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardList, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AttachmentLink } from "@/components/journals/attachment-link";
import { downloadCsv } from "@/lib/journals/csv";
import type { ShiftJournalRow } from "@/lib/data/journals";
import { adminDeleteShiftRecord } from "@/app/fleet/journals/admin-actions";

export function ShiftJournal({
  rows,
  isAdmin = false,
}: {
  rows: ShiftJournalRow[];
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [shownCount, setShownCount] = useState(100);
  const shown = rows.slice(0, shownCount);
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const [pending, start] = useTransition();
  const [toDelete, setToDelete] = useState<ShiftJournalRow | null>(null);

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
      ["Дата", "Смена", "Машина", "Водитель", "Часы", "Вид работ"],
      rows.map((r) => [
        r.date, r.shift === "day" ? "День" : "Ночь", r.reg, r.driver, r.hours, r.work_type,
      ]),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Записей: {rows.length} · Часов: {totalHours}
        </p>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
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
              <th className="px-3 py-2 font-medium">Подписи</th>
              {isAdmin ? <th className="px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => (
              <tr key={r.id} className="hover:bg-accent/40">
                <td className="whitespace-nowrap px-3 py-2">{r.date}</td>
                <td className="px-3 py-2">{r.shift === "day" ? "День" : "Ночь"}</td>
                <td className="px-3 py-2 font-medium">{r.reg}</td>
                <td className="px-3 py-2">{r.driver}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.hours}</td>
                <td className="px-3 py-2">{r.work_type}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <AttachmentLink bucket="signatures" path={r.driver_signature_path} label="вод." />
                    <AttachmentLink bucket="signatures" path={r.itr_signature_path} label="ИТР" />
                  </div>
                </td>
                {isAdmin ? (
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setToDelete(r)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={isAdmin ? 8 : 7}>
                <EmptyState icon={ClipboardList} title="Нет смен за период" description="Измените период или фильтры выше." className="border-0 p-6" />
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {rows.length > shownCount ? (
        <Button variant="outline" size="sm" className="self-center" onClick={() => setShownCount((n) => n + 200)}>
          Показать ещё ({rows.length - shownCount})
        </Button>
      ) : null}

      {isAdmin ? (
        <p className="text-xs text-muted-foreground">
          Правка часов — через переоткрытие журнала смены (экран «Табель», кнопка администратора).
        </p>
      ) : null}

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
