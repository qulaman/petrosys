"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtInt } from "@/lib/format";
import {
  FLOW_LABELS, addDays, completionWithTrucks, daysBetween, equipmentPlan, type Flow,
} from "@/lib/forecast";
import type { VolumeTabData } from "@/lib/data/forecast";

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };
const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
};
const FLOW_COLORS: Record<Flow, string> = {
  pit: "var(--chart-card)",
  local: "var(--chart-tanker)",
  prs: "var(--chart-cat-3)",
  stockpile: "var(--chart-cat-4)",
  total: "var(--chart-cat-6)",
};
const dm = (date: string) =>
  new Intl.DateTimeFormat("ru", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

function Kpi({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${alert ? "text-destructive" : ""}`}>{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function VolumeTab({ data: d }: { data: VolumeTabData }) {
  const s = d.settings;
  const last = d.lastDate ?? s.baseline_date;

  // Накопительный график: факт от якоря + план-прямая + веер сценариев до цели
  const cumulative = useMemo(() => {
    const rows: { date: string; label: string; fact?: number; plan?: number; base?: number; pess?: number; opt?: number }[] = [];
    let acc = s.baseline_volume_m3;
    const daysTotal = s.target_date ? daysBetween(s.baseline_date, s.target_date) : null;
    const planAt = (date: string) =>
      daysTotal && daysTotal > 0
        ? Math.min(s.target_volume_m3, Math.round(s.baseline_volume_m3 + ((s.target_volume_m3 - s.baseline_volume_m3) * daysBetween(s.baseline_date, date)) / daysTotal))
        : undefined;
    const byDate = new Map(d.daily.map((x) => [x.date, x.volume]));
    for (let date = s.baseline_date; date <= last; date = addDays(date, 1)) {
      acc += byDate.get(date) ?? 0;
      rows.push({ date, label: dm(date), fact: Math.round(acc), plan: planAt(date) });
    }
    // веер: до самой поздней из дат завершения (максимум 120 дней)
    const ends = [d.completion.pessimistic, d.completion.base, d.completion.optimistic].filter(Boolean) as string[];
    const horizon = ends.length ? ends.sort()[ends.length - 1] : null;
    if (horizon) {
      const lastFact = acc;
      const until = daysBetween(last, horizon) > 120 ? addDays(last, 120) : horizon;
      for (let date = addDays(last, 1); date <= until; date = addDays(date, 1)) {
        const n = daysBetween(last, date);
        const proj = (rate: number | null) =>
          rate ? Math.min(s.target_volume_m3, Math.round(lastFact + rate * n)) : undefined;
        rows.push({
          date, label: dm(date), plan: planAt(date),
          base: proj(d.scenarios.base), pess: proj(d.scenarios.pessimistic), opt: proj(d.scenarios.optimistic),
        });
      }
      const first = rows.find((r) => r.date === addDays(last, 1));
      const anchor = rows.find((r) => r.date === last);
      if (first && anchor) { anchor.base = anchor.fact; anchor.pess = anchor.fact; anchor.opt = anchor.fact; }
    }
    return rows;
  }, [d, s, last]);

  const dailyRows = useMemo(
    () =>
      d.daily.map((x) => ({
        label: dm(x.date),
        pit: x.flows.pit ?? 0,
        local: x.flows.local ?? 0,
        stockpile: x.flows.stockpile ?? 0,
        prs: x.flows.prs ?? 0,
        total: x.flows.total ?? 0,
        простой: x.downtime ? 1 : 0,
      })),
    [d.daily],
  );

  const completionLabel = (() => {
    const o = d.completion.optimistic ? dm(d.completion.optimistic) : "—";
    const p = d.completion.pessimistic ? dm(d.completion.pessimistic) : "—";
    return `${o} — ${p}`;
  })();

  return (
    <div className="flex flex-col gap-5">
      {/* Сводка */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          label={`Выполнено из ${fmtInt(s.target_volume_m3)} м³`}
          value={`${fmtInt(d.done)} (${d.donePct}%)`}
          sub={`остаток ${fmtInt(d.remaining)} м³`}
        />
        <Kpi
          label="Темп, м³/сутки (14 дн)"
          value={d.rates.w14.avg != null ? fmtInt(d.rates.w14.avg) : "—"}
          sub={d.rates.w14.avg != null ? `от ${fmtInt(d.rates.w14.min)} до ${fmtInt(d.rates.w14.max)}` : "нет данных"}
        />
        <Kpi label="Завершение (сценарии)" value={completionLabel} sub={d.completion.base ? `базовый: ${dm(d.completion.base)}` : undefined} />
        <Kpi
          label="График к целевой дате"
          value={s.target_date ? (d.scheduleGapDays == null ? "—" : d.scheduleGapDays > 0 ? `отставание ${d.scheduleGapDays} дн` : `опережение ${-d.scheduleGapDays} дн`) : "дата не задана"}
          alert={(d.scheduleGapDays ?? 0) > 0}
          sub={s.target_date ? `цель: ${dm(s.target_date)}` : undefined}
        />
        <Kpi label="Средний объём на рейс" value={`${d.m3PerTrip} м³`} sub={d.tripsCoveredDays ? `${d.tripsCoveredDays} дн. посчитано из Рейсов` : "все дни по сводкам"} />
      </div>

      {/* Накопительный объём и прогноз */}
      <section className="rounded-lg border p-3">
        <h3 className="mb-2 text-sm font-medium">Накопительный объём и прогноз</h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={cumulative} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => `${Math.round(v / 1000)}к`} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtInt(Number(v)) + " м³"} />
            <Legend formatter={(v) => <span style={{ color: "var(--foreground)", fontSize: 12 }}>{v}</span>} />
            <ReferenceLine y={s.target_volume_m3} stroke="var(--muted-foreground)" strokeDasharray="2 4" />
            <Line dataKey="fact" name="Факт" stroke="var(--chart-card)" strokeWidth={2} dot={false} />
            {s.target_date ? <Line dataKey="plan" name="План" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="6 4" dot={false} /> : null}
            <Line dataKey="base" name="Прогноз (базовый)" stroke="var(--chart-tanker)" strokeWidth={2} strokeDasharray="4 4" dot={false} />
            <Line dataKey="opt" name="Оптимистичный" stroke="var(--chart-cat-5)" strokeWidth={1.5} strokeDasharray="2 4" dot={false} />
            <Line dataKey="pess" name="Пессимистичный" stroke="var(--chart-cat-6)" strokeWidth={1.5} strokeDasharray="2 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </section>

      {/* Суточные объёмы по потокам */}
      <section className="rounded-lg border p-3">
        <h3 className="mb-2 text-sm font-medium">Суточный объём по потокам</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={dailyRows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => fmtInt(v)} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} formatter={(v) => fmtInt(Number(v)) + " м³"} />
            <Legend formatter={(v) => <span style={{ color: "var(--foreground)", fontSize: 12 }}>{v}</span>} />
            {(Object.keys(FLOW_COLORS) as Flow[]).map((f, i, arr) => (
              <Bar key={f} dataKey={f} name={FLOW_LABELS[f]} stackId="v" fill={FLOW_COLORS[f]}
                stroke="var(--background)" strokeWidth={1}
                radius={i === arr.length - 1 ? [4, 4, 0, 0] : undefined} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground">
          Дни без столбиков — нет данных (не считаются нулевыми). Темп считается только по рабочим дням.
        </p>
      </section>

      {/* Прогноз по неделям */}
      <section className="rounded-lg border p-3">
        <h3 className="mb-2 text-sm font-medium">Прогноз по неделям (накопительно)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Неделя</th>
                <th className="px-2 py-1.5 text-right font-medium">Пессимистичный</th>
                <th className="px-2 py-1.5 text-right font-medium">Базовый</th>
                <th className="px-2 py-1.5 text-right font-medium">Оптимистичный</th>
                <th className="px-2 py-1.5 text-right font-medium">% цели</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.periods.map((p) => (
                <tr key={p.endDate}>
                  <td className="px-2 py-1.5">{p.label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{p.pessimistic != null ? fmtInt(p.pessimistic) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{p.base != null ? fmtInt(p.base) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{p.optimistic != null ? fmtInt(p.optimistic) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{p.donePct != null ? `${p.donePct}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Planner data={d} />

      <p className="text-xs text-muted-foreground">
        Параметры (якорь, цель, коэффициенты) — в <Link href="/fleet/admin/forecast" className="text-primary underline">настройках прогноза</Link>;
        сводки геодезиста — на странице <Link href="/fleet/volume" className="text-primary underline">«Объём»</Link>.
      </p>
    </div>
  );
}

/** Планировщик техники: от срока → сколько машин; от машин → когда закончим. */
function Planner({ data: d }: { data: VolumeTabData }) {
  const s = d.settings;
  const last = d.lastDate ?? s.baseline_date;
  const [targetDate, setTargetDate] = useState(s.target_date ?? addDays(last, 60));
  const [trucks, setTrucks] = useState("30");
  const [shifts, setShifts] = useState<1 | 2>(2);

  const plan = d.scenarios.base
    ? equipmentPlan({
        remaining: d.remaining, lastDate: last, targetDate,
        baseRate: d.scenarios.base, m3PerTrip: d.m3PerTrip,
        tripsPerTruckShift: s.trips_per_truck_shift,
        trucksPerExcavator: s.trucks_per_excavator,
        availability: s.availability_coeff,
      })
    : null;
  const withTrucks = completionWithTrucks({
    remaining: d.remaining, lastDate: last,
    trucks: parseInt(trucks, 10) || 0, shifts,
    m3PerTrip: d.m3PerTrip, tripsPerTruckShift: s.trips_per_truck_shift,
    availability: s.availability_coeff,
  });
  const inputCls = "h-9 w-36 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <section className="grid gap-3 lg:grid-cols-2">
      <div className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
        <p className="font-medium">Успеть к дате — сколько техники нужно</p>
        <label className="flex items-center gap-2 text-muted-foreground">
          Целевая дата
          <input type="date" className={inputCls} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </label>
        {plan ? (
          plan.gapRate <= 0 ? (
            <p>Текущего темпа хватает: нужно {fmtInt(plan.requiredRate)} м³/сутки при факте {fmtInt(d.scenarios.base!)}.</p>
          ) : (
            <>
              <p>Требуемый темп {fmtInt(plan.requiredRate)} м³/сутки — не хватает {fmtInt(plan.gapRate)} м³/сутки (~{plan.extraTripsPerDay} рейсов/сутки).</p>
              <p className="font-medium">
                Дополнительно: {plan.extraTrucks.min}–{plan.extraTrucks.max} самосвалов и {plan.extraExcavators.min}–{plan.extraExcavators.max} экскаваторов.
              </p>
              <p className="text-xs text-muted-foreground">
                Оценочный диапазон (2 смены — 1 смена), доступность {s.availability_coeff}, {s.trips_per_truck_shift} рейсов/смену, {d.m3PerTrip} м³/рейс, экскаватор : самосвалы = 1:{s.trucks_per_excavator}.
              </p>
            </>
          )
        ) : (
          <p className="text-muted-foreground">Недостаточно данных для расчёта темпа.</p>
        )}
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
        <p className="font-medium">Когда закончим с имеющейся техникой</p>
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          Самосвалов
          <input inputMode="numeric" className={inputCls} value={trucks} onChange={(e) => setTrucks(e.target.value.replace(/\D/g, ""))} />
          <select className={inputCls} value={shifts} onChange={(e) => setShifts(Number(e.target.value) as 1 | 2)}>
            <option value={1}>1 смена</option>
            <option value={2}>2 смены</option>
          </select>
        </div>
        {withTrucks ? (
          <p>
            Расчётный темп <span className="font-medium">{fmtInt(withTrucks.rate)} м³/сутки</span> → завершение{" "}
            <span className="font-medium">{new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${withTrucks.date}T00:00:00Z`))}</span>
          </p>
        ) : (
          <p className="text-muted-foreground">Укажите количество самосвалов.</p>
        )}
      </div>
    </section>
  );
}
