"use client";

import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtInt } from "@/lib/format";
import type { HeatRow, WorkTabData } from "@/lib/data/dashboard";

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };
const tooltipStyle = {
  background: "var(--popover)", border: "1px solid var(--border)",
  borderRadius: 8, color: "var(--popover-foreground)", fontSize: 13,
};

/** Активность (часы и рейсы раздельно) + интервалы рейсов + выработка самосвалов. */
export function WorkTab({ data }: { data: WorkTabData }) {
  const singleDay = data.days.length === 1 && !data.weekly;
  // Интервалы: 0 — все самосвалы, дальше по машинам.
  const [intervalIdx, setIntervalIdx] = useState(0);
  const intervalGroup = data.intervals[Math.min(intervalIdx, data.intervals.length - 1)] ?? data.intervals[0];
  const colUnit = data.weekly ? "за неделю" : "за день";
  return (
    <div className="flex flex-col gap-6">
      {/* Моточасы */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          Моточасы <span className="text-muted-foreground">(часов {colUnit} · итог за период)</span>
        </h3>
        <HeatTable
          days={data.days}
          rows={data.hoursRows}
          maxCell={data.maxHoursCell}
          colorVar="var(--chart-card)"
          emptyText="Нет техники на моточасах"
        />
        <p className="text-xs text-muted-foreground">
          Пустые ячейки — простой/нет записей.
          {data.weekly ? " Период больше 60 дней — колонки агрегированы по неделям." : ""}
        </p>
      </section>

      {/* Рейсы */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          Рейсы самосвалов{" "}
          <span className="text-muted-foreground">
            {singleDay ? "(накопительно за день)" : `(рейсов ${colUnit} · итог за период)`}
          </span>
        </h3>
        {singleDay ? (
          <div className="flex flex-col divide-y rounded-lg border">
            {data.tripsRows.filter((r) => r.total > 0).map((r) => (
              <div key={r.reg} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-28 shrink-0 font-medium">{r.reg}</span>
                <span className="flex-1 truncate tracking-tight" style={{ color: "var(--chart-tanker)" }}>
                  {"✕".repeat(Math.min(r.total, 40))}
                </span>
                <span className="font-semibold tabular-nums">{fmtInt(r.total)}</span>
              </div>
            ))}
            {data.tripsRows.every((r) => r.total === 0) ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">Рейсов за день нет</p>
            ) : null}
          </div>
        ) : (
          <HeatTable
            days={data.days}
            rows={data.tripsRows}
            maxCell={data.maxTripsCell}
            colorVar="var(--chart-tanker)"
            emptyText="Нет самосвалов"
          />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Гистограмма интервалов */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              Интервалы между рейсами, мин{" "}
              <span className="text-muted-foreground">
                {intervalGroup?.median != null ? `· медиана ${intervalGroup.median} мин` : ""}
              </span>
            </h3>
            {data.intervals.length > 1 ? (
              <select
                value={intervalIdx}
                onChange={(e) => setIntervalIdx(Number(e.target.value))}
                className="rounded-md border bg-background px-2 py-1 text-xs"
                aria-label="Машина для гистограммы интервалов"
              >
                {data.intervals.map((g, i) => (
                  <option key={g.reg ?? "all"} value={i}>
                    {g.reg ?? "Все самосвалы"}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="h-56 rounded-lg border p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={intervalGroup?.buckets ?? []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
                <Bar dataKey="count" name="Ходок" fill="var(--chart-card)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground">
            Подозрительно короткие интервалы видны как левый столбец («&lt;15» — быстрее физически возможного).
          </p>
        </section>

        {/* Выработка самосвалов */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            Выработка самосвалов, рейсов/день{" "}
            <span className="text-muted-foreground">
              {data.productivityMedian != null ? `· медиана парка ${data.productivityMedian}` : ""}
            </span>
          </h3>
          <div className="h-56 rounded-lg border p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.productivity} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="reg" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={32} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
                {data.productivityMedian != null ? (
                  <ReferenceLine y={data.productivityMedian} stroke="var(--foreground)" strokeDasharray="4 4" />
                ) : null}
                <Bar dataKey="avgPerDay" name="Рейсов/день" fill="var(--chart-tanker)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground">Пунктир — медиана парка: отстающие и лидеры видны сразу.</p>
        </section>
      </div>
    </div>
  );
}

function HeatTable({
  days,
  rows,
  maxCell,
  colorVar,
  emptyText,
}: {
  days: string[];
  rows: HeatRow[];
  maxCell: number;
  colorVar: string;
  emptyText: string;
}) {
  const fmtVal = (n: number) => (Number.isInteger(n) ? fmtInt(n) : n.toFixed(1));
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-background px-2 py-1 text-left">Машина</th>
            {days.map((d) => (
              <th key={d} className="px-1 py-1 font-normal text-muted-foreground">{d}</th>
            ))}
            <th className="px-2 py-1 text-right">Итого</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.reg}>
              <td className="sticky left-0 bg-background px-2 py-1 font-medium whitespace-nowrap">{r.reg}</td>
              {r.cells.map((v, i) => (
                <td
                  key={i}
                  className="h-7 w-8 text-center tabular-nums"
                  style={{
                    background: v > 0
                      ? `color-mix(in srgb, ${colorVar} ${Math.round((v / maxCell) * 85) + 15}%, transparent)`
                      : "transparent",
                    color: v / maxCell > 0.6 ? "#fff" : "var(--foreground)",
                  }}
                  title={`${r.reg}: ${v}`}
                >
                  {v > 0 ? fmtVal(v) : ""}
                </td>
              ))}
              <td className="px-2 py-1 text-right font-semibold tabular-nums">
                {r.total > 0 ? fmtVal(r.total) : ""}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr><td className="px-2 py-4 text-muted-foreground">{emptyText}</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
