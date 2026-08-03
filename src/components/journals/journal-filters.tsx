"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { useNavProgress } from "@/components/nav-progress";
import { PERIOD_LABELS, PERIOD_PRESETS, resolvePeriod, type PeriodPreset } from "@/lib/journals/period";
import { FLOW_LABELS } from "@/lib/forecast";
import { VEHICLE_TYPE_LABELS_PLURAL } from "@/lib/domain";
import type { FilterOptions } from "@/lib/data/journals";

/** Высота под палец на телефоне, обычная плотность на десктопе. */
const BTN = "h-11 px-3.5 text-sm sm:h-7 sm:px-2.5 sm:text-[0.8rem]";

/**
 * Фильтры журналов: период всегда, дальше — по журналу. Техника/подрядчик
 * появляются, когда переданы справочники; смена/поток — в журнале объёма.
 */
export function JournalFilters({
  options,
  shiftFlow = false,
  vehicleType = false,
}: {
  options?: FilterOptions;
  shiftFlow?: boolean;
  /** Фильтр по виду техники — вход из графика «топливо по видам». */
  vehicleType?: boolean;
}) {
  const { pending, push } = useNavProgress();
  const pathname = usePathname();
  const sp = useSearchParams();

  const period = resolvePeriod({ period: sp.get("period") ?? undefined }).preset;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const vehicleId = sp.get("vehicle") ?? "";
  const contractorId = sp.get("contractor") ?? "";
  const type = sp.get("type") ?? "";
  const shift = sp.get("shift") ?? "";
  const flow = sp.get("flow") ?? "";
  const [clicked, setClicked] = useState<PeriodPreset | "apply" | null>(null);
  // Черновик дат: диапазон уходит на сервер одной навигацией по «Применить».
  // Сброс при смене периода — коррекция состояния во время рендера.
  const [draft, setDraft] = useState({ from, to });
  const [applied, setApplied] = useState({ from, to });
  if (applied.from !== from || applied.to !== to) {
    setApplied({ from, to });
    setDraft({ from, to });
  }

  function update(patch: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    push(`${pathname}?${p.toString()}`);
  }

  function pick(p: PeriodPreset) {
    setClicked(p);
    if (p !== "custom") {
      update({ period: p, from: null, to: null });
      return;
    }
    // «Период» открывается на текущем окне, а не на сегодняшнем дне.
    const cur = resolvePeriod({ period: sp.get("period") ?? undefined, from, to });
    update({ period: "custom", from: cur.fromDate, to: cur.dataToDate });
  }

  const dirty = period === "custom" && (draft.from !== from || draft.to !== to);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Период">
        {PERIOD_PRESETS.map((p) => (
          <Button
            key={p}
            size="sm"
            className={BTN}
            variant={period === p ? "default" : "outline"}
            aria-pressed={period === p}
            loading={pending && clicked === p}
            onClick={() => pick(p)}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>

      {period === "custom" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={draft.from} aria-label="Период с"
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} className="h-11 w-auto sm:h-9" />
          <span className="text-muted-foreground">—</span>
          <Input type="date" value={draft.to} aria-label="Период по"
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} className="h-11 w-auto sm:h-9" />
          <Button size="sm" className={BTN} variant={dirty ? "default" : "outline"}
            loading={pending && clicked === "apply"}
            onClick={() => { setClicked("apply"); update({ period: "custom", from: draft.from, to: draft.to }); }}>
            Применить
          </Button>
        </div>
      ) : null}

      <div className={`flex flex-wrap gap-2 ${pending ? "pointer-events-none opacity-60" : ""}`}>
        {options ? (
          <>
            <SearchSelect
              className="w-48"
              value={vehicleId}
              onChange={(val) => update({ vehicle: val })}
              options={options.vehicles.map((v) => ({ value: v.id, label: v.reg_number }))}
              emptyLabel="Вся техника"
            />
            <select
              value={contractorId}
              onChange={(e) => update({ contractor: e.target.value })}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Все подрядчики</option>
              {options.contractors.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </>
        ) : null}
        {vehicleType ? (
          <select
            aria-label="Вид техники"
            value={type}
            onChange={(e) => update({ type: e.target.value })}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">Все виды техники</option>
            {Object.entries(VEHICLE_TYPE_LABELS_PLURAL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        ) : null}
        {shiftFlow ? (
          <>
            <select
              aria-label="Смена"
              value={shift}
              onChange={(e) => update({ shift: e.target.value })}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Все смены</option>
              <option value="day">День</option>
              <option value="night">Ночь</option>
              <option value="total">За сутки</option>
            </select>
            <select
              aria-label="Поток"
              value={flow}
              onChange={(e) => update({ flow: e.target.value })}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Все потоки</option>
              {Object.entries(FLOW_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </>
        ) : null}
      </div>
    </div>
  );
}
