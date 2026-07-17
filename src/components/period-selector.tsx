"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavProgress } from "@/components/nav-progress";
import { PERIOD_LABELS, type PeriodPreset } from "@/lib/journals/period";

const PRESETS: PeriodPreset[] = ["today", "7d", "15d", "month", "custom"];

/** Лёгкий селектор периода (без фильтров машины/подрядчика). Пишет ?period/from/to. */
export function PeriodSelector({ extraParams }: { extraParams?: Record<string, string> }) {
  const { pending, push } = useNavProgress();
  const pathname = usePathname();
  const sp = useSearchParams();
  const period = (sp.get("period") as PeriodPreset) || "month";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const [clicked, setClicked] = useState<PeriodPreset | null>(null);

  function update(patch: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries({ ...extraParams, ...patch })) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    push(`${pathname}?${p.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <Button key={p} size="sm" variant={period === p ? "default" : "outline"}
            loading={pending && clicked === p}
            onClick={() => { setClicked(p); update({ period: p, ...(p !== "custom" ? { from: null, to: null } : {}) }); }}>
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>
      {period === "custom" ? (
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => update({ from: e.target.value })} className="h-9 w-auto" />
          <span className="text-muted-foreground">—</span>
          <Input type="date" value={to} onChange={(e) => update({ to: e.target.value })} className="h-9 w-auto" />
        </div>
      ) : null}
    </div>
  );
}
