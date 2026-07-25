"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { useNavProgress } from "@/components/nav-progress";
import { PERIOD_LABELS, type PeriodPreset } from "@/lib/journals/period";
import { FLOW_LABELS } from "@/lib/forecast";
import type { FilterOptions } from "@/lib/data/journals";

const PRESETS: PeriodPreset[] = ["today", "7d", "15d", "month", "custom"];

/**
 * Фильтры журналов: период всегда, дальше — по журналу. Техника/подрядчик
 * появляются, когда переданы справочники; смена/поток — в журнале объёма.
 */
export function JournalFilters({
  options,
  shiftFlow = false,
}: {
  options?: FilterOptions;
  shiftFlow?: boolean;
}) {
  const { pending, push } = useNavProgress();
  const pathname = usePathname();
  const sp = useSearchParams();

  const period = (sp.get("period") as PeriodPreset) || "month";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const vehicleId = sp.get("vehicle") ?? "";
  const contractorId = sp.get("contractor") ?? "";
  const shift = sp.get("shift") ?? "";
  const flow = sp.get("flow") ?? "";
  const [clicked, setClicked] = useState<PeriodPreset | null>(null);

  function update(patch: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    push(`${pathname}?${p.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={period === p ? "default" : "outline"}
            loading={pending && clicked === p}
            onClick={() => { setClicked(p); update({ period: p, ...(p !== "custom" ? { from: null, to: null } : {}) }); }}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>

      {period === "custom" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={from} onChange={(e) => update({ from: e.target.value })} className="h-9 w-auto" />
          <span className="text-muted-foreground">—</span>
          <Input type="date" value={to} onChange={(e) => update({ to: e.target.value })} className="h-9 w-auto" />
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
