"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { fmtInt, fmtLiters } from "@/lib/format";
import type { FuelTabData } from "@/lib/data/dashboard";

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };
const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 13,
};

export function FuelTab({ data }: { data: FuelTabData }) {
  const maxActual = Math.max(1, ...data.norm.map((n) => Math.max(n.actual, n.norm ?? 0)));
  const maxTop = Math.max(1, ...data.top.map((t) => t.liters));

  return (
    <div className="flex flex-col gap-6">
      {/* Выдачи по дням */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Выдачи топлива по дням, л</h3>
        <div className="h-64 w-full rounded-lg border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={16} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
              <Legend formatter={(v) => <span style={{ color: "var(--foreground)", fontSize: 12 }}>{v}</span>} />
              <Bar dataKey="card" name="Карта" stackId="a" fill="var(--chart-card)" />
              <Bar dataKey="tanker" name="Бензовоз" stackId="a" fill="var(--chart-tanker)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Расход к нормативу */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          Расход к нормативу, л/моточас <span className="text-muted-foreground">(риск-линия — норма договора)</span>
        </h3>
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          {data.norm.map((n) => (
            <div key={n.reg} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{n.reg}</span>
                <span style={n.over ? { color: "var(--chart-over)", fontWeight: 600 } : undefined}>
                  {n.actual} л/ч{n.norm != null ? ` · норма ${n.norm}` : " · нет нормы"}
                  {n.over ? " ⚠" : ""}
                </span>
              </div>
              <div className="relative h-3 rounded bg-muted">
                <div
                  className="absolute h-full rounded"
                  style={{
                    width: `${Math.min(100, (n.actual / maxActual) * 100)}%`,
                    background: n.over ? "var(--chart-over)" : "var(--chart-ok)",
                  }}
                />
                {n.norm != null ? (
                  <div
                    className="absolute -top-0.5 h-4 w-0.5 bg-foreground"
                    style={{ left: `${Math.min(100, (n.norm / maxActual) * 100)}%` }}
                    title={`норма ${n.norm}`}
                  />
                ) : null}
              </div>
            </div>
          ))}
          {data.norm.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет данных по моточасам за период</p>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Топ потребителей */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Топ потребителей топлива</h3>
          <div className="flex flex-col gap-2 rounded-lg border p-4">
            {data.top.map((t) => (
              <div key={t.reg} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm font-medium">{t.reg}</span>
                <div className="h-3 flex-1 rounded bg-muted">
                  <div className="h-full rounded" style={{ width: `${(t.liters / maxTop) * 100}%`, background: "var(--chart-card)" }} />
                </div>
                <span className="w-20 shrink-0 text-right text-sm tabular-nums">{fmtLiters(t.liters)}</span>
              </div>
            ))}
            {data.top.length === 0 ? <p className="text-sm text-muted-foreground">Выдач за период нет</p> : null}
          </div>
        </section>

        {/* Сверка карт — зависит от Фазы 3 */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Сверка карт · «ничейные литры»</h3>
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
            <AlertTriangle className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Появится после импорта выписки оператора АЗС (Фаза 3).
            </p>
          </div>
        </section>
      </div>

      <p className="text-xs text-muted-foreground">
        Всего за период: {fmtInt(data.top.reduce((s, t) => s + t.liters, 0))} л
      </p>
    </div>
  );
}
