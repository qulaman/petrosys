"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavProgress } from "@/components/nav-progress";
import { PERIOD_LABELS, PERIOD_PRESETS, resolvePeriod, type PeriodPreset } from "@/lib/journals/period";

/**
 * Высота под палец на телефоне (44 px по правилу полевых экранов) и обычная
 * плотность на десктопе — размер кнопки задаётся классом, вариантов cva с
 * брейкпоинтами не бывает.
 */
const BTN = "h-11 px-3.5 text-sm sm:h-7 sm:px-2.5 sm:text-[0.8rem]";

/** Лёгкий селектор периода (без фильтров машины/подрядчика). Пишет ?period/from/to. */
export function PeriodSelector({ extraParams }: { extraParams?: Record<string, string> }) {
  const { pending, push } = useNavProgress();
  const pathname = usePathname();
  const sp = useSearchParams();
  const period = resolvePeriod({ period: sp.get("period") ?? undefined }).preset;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const [clicked, setClicked] = useState<PeriodPreset | "apply" | null>(null);
  // Черновик дат: навигация только по «Применить». Раньше каждый onChange уводил
  // на сервер, и выбор диапазона стоил двух загрузок, причём первая — по
  // бессмысленному промежуточному окну (новое «с», старое «по»).
  // Сброс черновика при смене периода — коррекция состояния во время рендера
  // (штатный приём React вместо setState в эффекте, который даёт лишний проход).
  const [draft, setDraft] = useState({ from, to });
  const [applied, setApplied] = useState({ from, to });
  if (applied.from !== from || applied.to !== to) {
    setApplied({ from, to });
    setDraft({ from, to });
  }

  function update(patch: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries({ ...extraParams, ...patch })) {
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
    // «Период» открывается на текущем окне, а не на сегодняшнем дне: иначе
    // переход с «15 дней» молча сбрасывал выбор в один день.
    const cur = resolvePeriod({ period: sp.get("period") ?? undefined, from, to });
    update({ period: "custom", from: cur.fromDate, to: cur.dataToDate });
  }

  const dirty = period === "custom" && (draft.from !== from || draft.to !== to);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Период">
        {PERIOD_PRESETS.map((p) => (
          <Button key={p} size="sm" className={BTN} variant={period === p ? "default" : "outline"}
            aria-pressed={period === p}
            loading={pending && clicked === p}
            onClick={() => pick(p)}>
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
    </div>
  );
}
