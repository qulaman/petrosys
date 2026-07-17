"use client";

import {
  Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtInt } from "@/lib/format";
import type { WorkTabData } from "@/lib/data/dashboard";

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };
const tooltipStyle = {
  background: "var(--popover)", border: "1px solid var(--border)",
  borderRadius: 8, color: "var(--popover-foreground)", fontSize: 13,
};

/** Тепловая карта активности + интервалы рейсов + выработка самосвалов. */
export function WorkTab({ data }: { data: WorkTabData }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Теплокарта */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          Активность: машина × день{" "}
          <span className="text-muted-foreground">(моточасы — часы, самосвалы — рейсы)</span>
        </h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-background px-2 py-1 text-left">Машина</th>
                {data.days.map((d) => (
                  <th key={d} className="px-1 py-1 font-normal text-muted-foreground">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.reg}>
                  <td className="sticky left-0 bg-background px-2 py-1 font-medium whitespace-nowrap">
                    {r.reg} <span className="text-muted-foreground">{r.type === "trips" ? "р" : "ч"}</span>
                  </td>
                  {r.cells.map((v, i) => (
                    <td
                      key={i}
                      className="h-7 w-8 text-center tabular-nums"
                      style={{
                        background: v > 0
                          ? `color-mix(in srgb, var(--chart-card) ${Math.round((v / data.maxCell) * 85) + 15}%, transparent)`
                          : "transparent",
                        color: v / data.maxCell > 0.6 ? "#fff" : "var(--foreground)",
                      }}
                      title={`${r.reg}: ${v}`}
                    >
                      {v > 0 ? fmtInt(v) : ""}
                    </td>
                  ))}
                </tr>
              ))}
              {data.rows.length === 0 ? (
                <tr><td className="px-2 py-4 text-muted-foreground">Нет техники</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Пустые ячейки — простой/нет записей.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Гистограмма интервалов */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            Интервалы между рейсами, мин{" "}
            <span className="text-muted-foreground">
              {data.intervalMedian != null ? `· медиана ${data.intervalMedian} мин` : ""}
            </span>
          </h3>
          <div className="h-56 rounded-lg border p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.intervalBuckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
