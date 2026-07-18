"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveDetectorSettings } from "./actions";

export interface DetectorSettings {
  tanker_gap_liters: number;
  no_fuel_days_trips: number;
  no_fuel_days_hours: number;
}

const FIELDS: { key: keyof DetectorSettings; label: string; hint: string }[] = [
  {
    key: "tanker_gap_liters",
    label: "Допуск расхождения бензовоза, л",
    hint: "Замер остатка может отличаться от расчётного на эту величину без аномалии «Расхождение по бензовозу».",
  },
  {
    key: "no_fuel_days_trips",
    label: "Дней работы без заправки — самосвалы",
    hint: "Самосвал работает столько дней подряд без единой выдачи топлива → аномалия «Работа без топлива».",
  },
  {
    key: "no_fuel_days_hours",
    label: "Дней работы без заправки — остальная техника",
    hint: "То же для техники на моточасах (грейдеры, экскаваторы и т.д.).",
  },
];

export function SettingsForm({ initial }: { initial: DetectorSettings }) {
  const [form, setForm] = useState<Record<keyof DetectorSettings, string>>({
    tanker_gap_liters: String(initial.tanker_gap_liters),
    no_fuel_days_trips: String(initial.no_fuel_days_trips),
    no_fuel_days_hours: String(initial.no_fuel_days_hours),
  });
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await saveDetectorSettings({
        tanker_gap_liters: parseFloat(form.tanker_gap_liters),
        no_fuel_days_trips: parseInt(form.no_fuel_days_trips, 10),
        no_fuel_days_hours: parseInt(form.no_fuel_days_hours, 10),
      });
      if (res.ok) toast.success("Настройки сохранены — применятся при следующем пересчёте аномалий");
      else toast.error(res.error);
    });
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {FIELDS.map((f) => (
        <div key={f.key} className="flex flex-col gap-1">
          <label className="text-sm font-medium">{f.label}</label>
          <Input
            value={form[f.key]}
            inputMode="decimal"
            onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value.replace(/[^\d.]/g, "") }))}
            className="w-36"
          />
          <p className="text-xs text-muted-foreground">{f.hint}</p>
        </div>
      ))}
      <div>
        <Button loading={pending} onClick={submit}>Сохранить</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Пороги используются детекторами при ежедневном ночном прогоне и по кнопке «Пересчитать сейчас» в центре аномалий.
      </p>
    </div>
  );
}
