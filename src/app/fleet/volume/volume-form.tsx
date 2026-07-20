"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtInt } from "@/lib/format";
import { FLOW_LABELS, type Flow } from "@/lib/forecast";
import type { FactRow } from "@/lib/data/forecast";
import { createProductionFact, deleteProductionFact } from "./actions";

const STATUS_LABELS: Record<string, string> = {
  work: "Рабочий день",
  downtime_weather: "Простой — погода",
  downtime_tech: "Простой — техника",
};
const SHIFT_LABELS: Record<string, string> = { day: "День", night: "Ночь" };

const selectCls =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function VolumeForm({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState<string>("");
  const [status, setStatus] = useState<string>("work");
  const [flow, setFlow] = useState<string>("pit");
  const [trips, setTrips] = useState("");
  const [volume, setVolume] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const work = status === "work";

  function submit() {
    start(async () => {
      const res = await createProductionFact({
        work_date: date,
        shift_type: shift || null,
        flow: work ? (flow as Flow) : null,
        trips_count: trips ? parseInt(trips, 10) : null,
        volume_m3: volume ? parseFloat(volume.replace(",", ".")) : null,
        day_status: status,
        note: note || undefined,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Сводка сохранена");
      setTrips(""); setVolume(""); setNote("");
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Новая запись сводки</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Дата
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Смена
          <select className={selectCls} value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="">За сутки</option>
            <option value="day">День</option>
            <option value="night">Ночь</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Статус дня
          <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {work ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Поток
              <select className={selectCls} value={flow} onChange={(e) => setFlow(e.target.value)}>
                {Object.entries(FLOW_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Рейсов (необязательно)
              <Input inputMode="numeric" value={trips} onChange={(e) => setTrips(e.target.value.replace(/\D/g, ""))} placeholder="151" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Объём, м³
              <Input inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="2869" />
            </label>
          </>
        ) : null}
        <label className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-3">
          Примечание
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="дождь до обеда / +1 бульдозер" />
        </label>
      </div>
      <div>
        <Button onClick={submit} loading={pending}>Сохранить</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        За день можно внести несколько записей — по одной на поток (и смену). Дни без записей прогноз не считает нулевыми.
      </p>
    </div>
  );
}

export function FactList({ rows, canDelete }: { rows: FactRow[]; canDelete: boolean }) {
  const [pending, start] = useTransition();

  function remove(id: string) {
    start(async () => {
      const res = await deleteProductionFact(id);
      if (!res.ok) toast.error(res.error);
      else toast.success("Запись удалена");
    });
  }

  const byDate = new Map<string, FactRow[]>();
  for (const r of rows) byDate.set(r.work_date, [...(byDate.get(r.work_date) ?? []), r]);

  return (
    <div className="flex flex-col gap-3">
      {[...byDate.entries()].map(([date, list]) => {
        const total = list.reduce((a, r) => a + Number(r.volume_m3 ?? 0), 0);
        return (
          <div key={date} className="rounded-lg border">
            <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-1.5 text-sm">
              <span className="font-medium">{date}</span>
              <span className="tabular-nums text-muted-foreground">{fmtInt(Math.round(total))} м³</span>
            </div>
            <div className="divide-y">
              {list.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="flex-1">
                    {r.day_status !== "work"
                      ? STATUS_LABELS[r.day_status]
                      : FLOW_LABELS[(r.flow ?? "total") as Flow]}
                    {r.shift_type ? ` · ${SHIFT_LABELS[r.shift_type]}` : ""}
                    {r.note ? <span className="text-muted-foreground"> — {r.note}</span> : null}
                  </span>
                  {r.trips_count ? <span className="tabular-nums text-muted-foreground">{r.trips_count} р.</span> : null}
                  <span className="w-20 text-right tabular-nums">{r.volume_m3 != null ? `${fmtInt(Number(r.volume_m3))} м³` : "—"}</span>
                  {canDelete ? (
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => remove(r.id)} disabled={pending}>
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Сводок пока нет.</p> : null}
    </div>
  );
}
