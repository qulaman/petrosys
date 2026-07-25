"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FLOW_LABELS, type Flow } from "@/lib/forecast";
import { createProductionFact } from "./actions";

const STATUS_LABELS: Record<string, string> = {
  work: "Рабочий день",
  downtime_weather: "Простой — погода",
  downtime_tech: "Простой — техника",
};
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
        Внесённое смотрите и правьте в журнале объёма.
      </p>
    </div>
  );
}
