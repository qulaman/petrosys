"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Wallet } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtMoney, fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ContractMoney, MoneyTabData } from "@/lib/data/dashboard";

// Категориальная палитра из темы (см. globals.css) — корректна в light/dark/sun.
const PIE_COLORS = [
  "var(--chart-card)", "var(--chart-tanker)", "var(--chart-cat-3)",
  "var(--chart-cat-4)", "var(--chart-cat-5)", "var(--chart-cat-6)",
];
const tooltipStyle = {
  background: "var(--popover)", border: "1px solid var(--border)",
  borderRadius: 8, color: "var(--popover-foreground)", fontSize: 13,
};

type SortKey = "number" | "contractor" | "accrual" | "fuelHold" | "penalty" | "net" | "forecast";

const SORT_COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "number", label: "Договор", numeric: false },
  { key: "contractor", label: "Подрядчик", numeric: false },
  { key: "accrual", label: "Начислено", numeric: true },
  { key: "fuelHold", label: "− ГСМ", numeric: true },
  { key: "penalty", label: "− Штрафы", numeric: true },
  { key: "net", label: "К оплате", numeric: true },
  { key: "forecast", label: "Прогноз АВР", numeric: true },
];

export function MoneyTab({ data }: { data: MoneyTabData }) {
  const sp = useSearchParams();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "number", desc: false });

  // Ссылка на расчёт договора с сохранением выбранного периода.
  const settlementHref = (c: ContractMoney) => {
    const q = new URLSearchParams({ contract: c.id });
    for (const k of ["period", "from", "to"]) {
      const v = sp.get(k);
      if (v) q.set(k, v);
    }
    return `/fleet/office/settlement?${q.toString()}`;
  };

  const rows = useMemo(() => {
    const out = [...data.contracts];
    const { key, desc } = sort;
    out.sort((a, b) => {
      const cmp = key === "number" || key === "contractor"
        ? a[key].localeCompare(b[key], "ru")
        : a[key] - b[key];
      return desc ? -cmp : cmp;
    });
    return out;
  }, [data.contracts, sort]);

  const totals = useMemo(() => data.contracts.reduce(
    (t, c) => ({
      accrual: t.accrual + c.accrual,
      fuelHold: t.fuelHold + c.fuelHold,
      penalty: t.penalty + c.penalty,
      net: t.net + c.net,
      forecast: t.forecast + c.forecast,
      trips: t.trips + c.tripsCount,
      hours: t.hours + c.hoursSum,
    }),
    { accrual: 0, fuelHold: 0, penalty: 0, net: 0, forecast: 0, trips: 0, hours: 0 },
  ), [data.contracts]);

  const maxNet = Math.max(1, ...data.contracts.map((c) => Math.abs(c.net)));
  const pieData = data.contracts.filter((c) => c.net > 0).map((c) => ({ name: c.contractor, value: c.net }));
  const effectiveRows = rows.filter((c) => c.tripsCount > 0 || c.hoursSum > 0);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: SORT_COLUMNS.find((c) => c.key === key)!.numeric }));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Начислено и прогноз АВР по договорам</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                {SORT_COLUMNS.map((col) => (
                  <th key={col.key} className={cn("px-3 py-2", col.numeric && "text-right")}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn("inline-flex items-center gap-1 hover:text-foreground", sort.key === col.key ? "text-foreground" : "")}
                      title="Сортировать"
                    >
                      {col.label}
                      {sort.key === col.key ? (
                        sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />
                      ) : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-accent/40">
                  <td className="px-3 py-2 font-medium">
                    <Link href={settlementHref(c)} className="hover:underline" title="Открыть расчёт по договору">
                      {c.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{c.contractor}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.accrual)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.fuelHold)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.penalty)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtMoney(c.net)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(c.forecast)}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState icon={Wallet} title="Договоров нет" description="Начисления появятся после добавления договоров и записей о работе." className="border-0 p-6" />
                </td></tr>
              ) : null}
            </tbody>
            {rows.length > 0 ? (
              <tfoot className="border-t bg-muted/50 font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>Итого</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(totals.accrual)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(totals.fuelHold)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(totals.penalty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(totals.net)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(totals.forecast)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
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
              {effectiveRows.map((c) => (
                <tr key={c.id} className="hover:bg-accent/40">
                  <td className="px-3 py-2">
                    <Link href={settlementHref(c)} className="hover:underline" title="Открыть расчёт по договору">
                      {c.contractor} <span className="text-muted-foreground">· {c.number}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(c.tripsCount)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{c.costPerTrip != null ? fmtMoney(c.costPerTrip) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(c.hoursSum)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{c.costPerHour != null ? fmtMoney(c.costPerHour) : "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{c.tengePerM3 != null ? fmtMoney(c.tengePerM3) : "—"}</td>
                </tr>
              ))}
              {effectiveRows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Нет работ за период</td></tr>
              ) : null}
            </tbody>
            {effectiveRows.length > 0 ? (
              <tfoot className="border-t bg-muted/50 font-semibold">
                <tr>
                  <td className="px-3 py-2">Итого</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(totals.trips)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(totals.hours)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          ₸/м³ — полная стоимость кубометра перевезённого грунта (объём рейса из маршрута) — ключевая метрика себестоимости.
        </p>
        <p className="text-sm">
          Прогноз суммы АВР на конец периода (все договоры):{" "}
          <span className="font-semibold tabular-nums">{fmtMoney(totals.forecast)}</span>
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
              <div key={c.id} className="flex items-center gap-3">
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
