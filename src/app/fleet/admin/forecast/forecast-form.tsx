"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveForecastSettings } from "./actions";

export interface ForecastSettingsInput {
  baseline_date: string;
  baseline_volume_m3: number;
  target_volume_m3: number;
  target_date: string | null;
  trucks_per_excavator: number;
  availability_coeff: number;
  trips_per_truck_shift: number;
}

const NUM_FIELDS: { key: keyof ForecastSettingsInput; label: string; hint: string; int?: boolean }[] = [
  { key: "baseline_volume_m3", label: "Объём на якорную дату, м³", hint: "Сколько было выполнено к дате якоря (даёт точку отсчёта накопительного графика)." },
  { key: "target_volume_m3", label: "Целевой объём, м³", hint: "Общий объём насыпи по проекту." },
  { key: "trucks_per_excavator", label: "Самосвалов на 1 экскаватор", hint: "Норма погрузки (по сменным нормам 3/30 и 5/50 — 10).", int: true },
  { key: "trips_per_truck_shift", label: "Рейсов на самосвал за смену", hint: "Фактическая норма на длинном плече (~15).", int: true },
  { key: "availability_coeff", label: "Коэффициент доступности", hint: "Доля техники, реально работающей (простои, ремонты): 0.75 по умолчанию." },
];

export function ForecastForm({ initial }: { initial: ForecastSettingsInput }) {
  const [form, setForm] = useState({
    baseline_date: initial.baseline_date,
    target_date: initial.target_date ?? "",
    baseline_volume_m3: String(initial.baseline_volume_m3),
    target_volume_m3: String(initial.target_volume_m3),
    trucks_per_excavator: String(initial.trucks_per_excavator),
    availability_coeff: String(initial.availability_coeff),
    trips_per_truck_shift: String(initial.trips_per_truck_shift),
  });
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await saveForecastSettings({
        baseline_date: form.baseline_date,
        target_date: form.target_date || null,
        baseline_volume_m3: parseFloat(form.baseline_volume_m3),
        target_volume_m3: parseFloat(form.target_volume_m3),
        trucks_per_excavator: parseInt(form.trucks_per_excavator, 10),
        availability_coeff: parseFloat(form.availability_coeff),
        trips_per_truck_shift: parseInt(form.trips_per_truck_shift, 10),
      });
      if (res.ok) toast.success("Параметры прогноза сохранены");
      else toast.error(res.error);
    });
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">Якорная дата</label>
        <Input type="date" className="w-44" value={form.baseline_date}
          onChange={(e) => setForm((s) => ({ ...s, baseline_date: e.target.value }))} />
        <p className="text-xs text-muted-foreground">С этой даты накопительный объём считается от значения ниже.</p>
      </div>
      {NUM_FIELDS.map((f) => (
        <div key={f.key} className="flex flex-col gap-1">
          <label className="text-sm font-medium">{f.label}</label>
          <Input
            value={form[f.key as keyof typeof form] as string}
            inputMode="decimal"
            onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value.replace(/[^\d.]/g, "") }))}
            className="w-44"
          />
          <p className="text-xs text-muted-foreground">{f.hint}</p>
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">Целевая дата завершения (необязательно)</label>
        <Input type="date" className="w-44" value={form.target_date}
          onChange={(e) => setForm((s) => ({ ...s, target_date: e.target.value }))} />
        <p className="text-xs text-muted-foreground">
          Если задана — дашборд показывает отставание от графика и требуемую дополнительную технику.
        </p>
      </div>
      <div>
        <Button loading={pending} onClick={submit}>Сохранить</Button>
      </div>
    </div>
  );
}
