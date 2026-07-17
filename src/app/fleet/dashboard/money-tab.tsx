"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtMoney, fmtInt } from "@/lib/format";
import type { MoneyTabData } from "@/lib/data/dashboard";

const PIE_COLORS = ["var(--chart-card)", "var(--chart-tanker)", "#e87ba4", "#eda100", "#1baf7a", "#eb6834"];
const tooltipStyle = {
  background: "var(--popover)", border: "1px solid var(--border)",
  borderRadius: 8, color: "var(--popover-foreground)", fontSize: 13,
};

export function MoneyTab({ data }: { data: MoneyTabData }) {
  const totalForecast = data.contracts.reduce((s, c) => s + c.forecast, 0);
  const maxNet = Math.max(1, ...data.contracts.map((c) => Math.abs(c.net)));
  const pieData = data.contracts.filter((c) => c.net > 0).map((c) => ({ name: c.contractor, value: c.net }));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Начислено и прогноз АВР по договорам</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Договор</th>
                <th className="px-3 py-2">Подрядчик</th>
                <th className="px-3 py-2 text-right">Начислено</th>
                <th className="px-3 py-2 text-right">− ГСМ</th>
                <th className="px-3 py-2 text-right">− Штрафы</th>
                <th className="px-3 py-2 text-right">К оплате</th>
                <th className="px-3 py-2 text-right">Прогноз АВР</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.contracts.map((c) => (
                <tr key={c.number}>
                  <td className="px-3 py-2 font-medium">{c.number}</td>
                  <td className="px-3 py-2">{c.contractor}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.accrual)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.fuelHold)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.penalty)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtMoney(c.net)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(c.forecast)}</td>
                </tr>
              ))}
              {data.contracts.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">Договоров нет</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-sm">
          Прогноз суммы АВР на конец периода (все договоры):{" "}
          <span className="font-semibold tabular-nums">{fmtMoney(totalForecast)}</span>
        </p>
      </section>

      {/* Эффективная стоимость — база для переговоров по ставкам */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Эффективная стоимость (к оплате с учётом удержаний)</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Подрядчик · договор</th>
                <th className="px-3 py-2 text-right">Рейсов</th>
                <th className="px-3 py-2 text-right">₸/рейс</th>
                <th className="px-3 py-2 text-right">Часов</th>
                <th className="px-3 py-2 text-right">₸/час</th>
                <th className="px-3 py-2 text-right">₸/м³ грунта</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.contracts.filter((c) => c.tripsCount > 0 || c.hoursSum > 0).map((c) => (
                <tr key={c.number}>
                  <td className="px-3 py-2">{c.contractor} <span className="text-muted-foreground">· {c.number}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(c.tripsCount)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{c.costPerTrip != null ? fmtMoney(c.costPerTrip) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(c.hoursSum)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{c.costPerHour != null ? fmtMoney(c.costPerHour) : "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.tengePerM3 != null ? fmtMoney(c.tengePerM3) : "—"}</td>
                </tr>
              ))}
              {data.contracts.every((c) => c.tripsCount === 0 && c.hoursSum === 0) ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Нет работ за период</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          ₸/м³ — полная стоимость кубометра перевезённого грунта (объём рейса из маршрута) — ключевая метрика себестоимости.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Доли */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Доля подрядчиков в сумме «к оплате»</h3>
          <div className="h-56 rounded-lg border p-2">
            {pieData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="var(--background)" strokeWidth={2}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMoney(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">Нет начислений за период</p>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            {pieData.map((d, i) => (
              <span key={d.name} className="flex items-center gap-1.5">
                <span className="size-3 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                {d.name}
              </span>
            ))}
          </div>
        </section>

        {/* Bar долей (дублирующий канал для доступности) */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">«К оплате» по договорам</h3>
          <div className="flex flex-col gap-2 rounded-lg border p-4">
            {data.contracts.map((c) => (
              <div key={c.number} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-sm">{c.contractor}</span>
                <div className="h-3 flex-1 rounded bg-muted">
                  <div className="h-full rounded" style={{ width: `${(Math.abs(c.net) / maxNet) * 100}%`, background: "var(--chart-card)" }} />
                </div>
                <span className="w-28 shrink-0 text-right text-sm tabular-nums">{fmtMoney(c.net)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
