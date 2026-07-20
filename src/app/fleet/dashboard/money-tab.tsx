"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Area, AreaChart, CartesianGrid, Cell, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, ArrowDown as ArrowDownIcon, ArrowUp as ArrowUpIcon, ChevronDown, Coins, Fuel, Gavel, TrendingUp, Wallet } from "lucide-react";
import { fmtMoney, fmtInt } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { ContractMoney, MoneyTabData } from "@/lib/data/dashboard";

// Категориальная палитра из темы (см. globals.css) — корректна в light/dark/sun.
const PIE_COLORS = [
  "var(--chart-card)", "var(--chart-tanker)", "var(--chart-cat-3)",
  "var(--chart-cat-4)", "var(--chart-cat-5)", "var(--chart-cat-6)",
];
const OTHER_COLOR = "var(--muted-foreground)";
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

const TYPE_LABEL = (t: string) => (t === "transportation" ? "перевозка" : "услуги техники");

function StatTile({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub?: string; icon: React.ElementType; accent?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-lg border p-4", accent ? "border-primary/40 bg-primary/5" : "")}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

export function MoneyTab({ data }: { data: MoneyTabData }) {
  const sp = useSearchParams();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "net", desc: true });
  const [unbilledOpen, setUnbilledOpen] = useState(false);

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

  const s = data.summary;
  const effectiveRows = rows.filter((c) => c.tripsCount > 0 || c.hoursSum > 0);

  // Рейтинг подрядчиков по «к оплате»: топ-6 секторов + «Прочие», нумерация 1..N.
  const ranking = useMemo(() => {
    const positive = data.contracts.filter((c) => c.net > 0).sort((a, b) => b.net - a.net);
    const total = positive.reduce((sum, c) => sum + c.net, 0) || 1;
    const ranked = positive.map((c, i) => ({
      rank: i + 1, name: c.contractor, net: c.net, share: Math.round((c.net / total) * 100),
    }));
    const TOP = 6;
    const top = ranked.slice(0, TOP);
    const rest = ranked.slice(TOP);
    const pie = top.map((r) => ({ name: `${r.rank}. ${r.name}`, value: r.net }));
    if (rest.length) pie.push({ name: `Прочие (${rest.length})`, value: rest.reduce((sum, r) => sum + r.net, 0) });
    return { ranked, top, restCount: rest.length, pie };
  }, [data.contracts]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: SORT_COLUMNS.find((c) => c.key === key)!.numeric }));

  return (
    <div className="flex flex-col gap-6">
      {/* Сводка периода */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Начислено" value={fmtMoney(s.accrual)} icon={Coins} />
        <StatTile label="Удержано ГСМ" value={fmtMoney(s.fuelHold)} icon={Fuel} />
        <StatTile label="Штрафы" value={fmtMoney(s.penalty)} icon={Gavel} />
        <StatTile label="К оплате" value={fmtMoney(s.net)} icon={Wallet} accent />
        <StatTile label="Прогноз АВР" value={fmtMoney(s.forecast)} icon={TrendingUp}
          sub={`прошло ${s.elapsedDays} из ${s.totalDays} дн.`} />
      </div>

      {/* Вне расчётов — работа, не попавшая в деньги */}
      {data.unbilledSummary.vehicles > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <button type="button" onClick={() => setUnbilledOpen((v) => !v)} className="flex items-center gap-2 text-left">
              <AlertTriangle className="size-5 shrink-0 text-amber-600" />
              <span className="font-medium">
                Вне расчётов: {fmtInt(data.unbilledSummary.trips)} рейсов · {fmtInt(data.unbilledSummary.hours)} ч
                <span className="text-muted-foreground"> · {data.unbilledSummary.vehicles} машин</span>
              </span>
              <ChevronDown className={cn("ml-auto size-4 transition-transform", unbilledOpen ? "rotate-180" : "")} />
            </button>
            <p className="text-xs text-muted-foreground">
              Работа этих машин не участвует во взаиморасчётах: нет договора или в прайсе договора не задана ставка для их вида техники.
            </p>
            {unbilledOpen ? (
              <div className="overflow-x-auto rounded-lg border bg-background">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2">Машина</th>
                      <th className="px-3 py-2">Причина</th>
                      <th className="px-3 py-2">Подрядчик · договор</th>
                      <th className="px-3 py-2 text-right">Рейсов</th>
                      <th className="px-3 py-2 text-right">Часов</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.unbilled.map((u) => (
                      <tr key={u.reg} className="hover:bg-accent/40">
                        <td className="px-3 py-2 font-medium">{u.reg}</td>
                        <td className="px-3 py-2">
                          <span className={cn(
                            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
                            u.reason === "no_contract"
                              ? "border-destructive/30 bg-destructive/10 text-destructive"
                              : "border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400",
                          )}>
                            <span className="size-1.5 rounded-full bg-current" />
                            {u.reason === "no_contract" ? "нет договора" : "нет ставки в прайсе"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {u.contractId ? (
                            <Link href={`/fleet/admin/contracts/${u.contractId}`} className="hover:underline" title="Открыть договор — добавить ставку в прайс">
                              {u.contractor} <span className="text-muted-foreground">· {u.contractNumber}</span>
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{u.trips || ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{u.hours ? fmtInt(u.hours) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Накопление начислений */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          Начисления нарастающим итогом, ₸ <span className="text-muted-foreground">(пунктир — прогноз до конца периода)</span>
        </h3>
        <div className="h-56 rounded-lg border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.daily} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-card)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-card)" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={20} />
              <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => fmtInt(Number(v))} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtMoney(Number(v)), n === "accrued" ? "Факт" : "Прогноз"]} />
              <Line dataKey="forecast" name="Прогноз" stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={2} dot={false} />
              <Area dataKey="accrued" name="Факт" stroke="var(--chart-card)" strokeWidth={2} fill="url(#accGrad)" connectNulls={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Начислено и прогноз по договорам */}
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
                      {sort.key === col.key ? (sort.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />) : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-accent/40">
                  <td className="px-3 py-2 font-medium">
                    <Link href={settlementHref(c)} className="hover:underline" title="Открыть расчёт по договору">{c.number}</Link>
                    <span className="ml-1.5 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">{TYPE_LABEL(c.contract_type)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={settlementHref(c)} className="hover:underline">{c.contractor}</Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.accrual)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.fuelHold)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(c.penalty)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtMoney(c.net)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(c.forecast)}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={7}><EmptyState icon={Wallet} title="Договоров нет" description="Начисления появятся после добавления договоров и записей о работе." className="border-0 p-6" /></td></tr>
              ) : null}
            </tbody>
            {rows.length > 0 ? (
              <tfoot className="border-t bg-muted/50 font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>Итого</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.accrual)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.fuelHold)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.penalty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.net)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(s.forecast)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      {/* Эффективная стоимость */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Эффективная стоимость (к оплате с учётом удержаний)</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Подрядчик · договор</th>
                <th className="px-3 py-2 text-right">Рейсов</th>
                <th className="px-3 py-2 text-right" title="Начислено за рейсы минус доля удержаний, делённое на число рейсов. Часовые начисления сюда не входят.">₸/рейс</th>
                <th className="px-3 py-2 text-right">Часов</th>
                <th className="px-3 py-2 text-right" title="Начислено за моточасы минус доля удержаний, делённое на часы. Рейсовые начисления сюда не входят.">₸/час</th>
                <th className="px-3 py-2 text-right" title="Рейсовая часть «к оплате», делённая на кубометры перевезённого грунта (объём — из маршрута).">₸/м³ грунта</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {effectiveRows.map((c) => (
                <tr key={c.id} className="hover:bg-accent/40">
                  <td className="px-3 py-2">
                    <Link href={settlementHref(c)} className="hover:underline">
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
                <tr><td colSpan={6}><EmptyState icon={Wallet} title="Нет работ за период" className="border-0 p-6" /></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          ₸/рейс и ₸/час считаются каждая от своей части начислений (рейсовой и часовой) — у смешанных договоров
          они не пересекаются; удержания ГСМ и штрафы распределены пропорционально. ₸/м³ — рейсовая часть на кубометр
          перевезённого грунта (объём рейса из маршрута) — ключевая метрика себестоимости.
        </p>
      </section>

      {/* Рейтинг подрядчиков: круг топ-6 + нумерованный список */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Рейтинг подрядчиков по сумме «к оплате»</h3>
        <div className="grid gap-4 rounded-lg border p-4 lg:grid-cols-2">
          <div className="h-64">
            {ranking.pie.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ranking.pie} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="var(--background)" strokeWidth={2}>
                    {ranking.pie.map((d, i) => (
                      <Cell key={i} fill={d.name.startsWith("Прочие") ? OTHER_COLOR : PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMoney(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState icon={Wallet} title="Нет начислений за период" className="h-full border-0" />
            )}
          </div>
          <ol className="flex flex-col gap-1.5 text-sm">
            {ranking.ranked.slice(0, 12).map((r) => (
              <li key={r.rank} className="flex items-center gap-2">
                <span
                  className="grid size-5 shrink-0 place-items-center rounded text-[11px] font-semibold text-white"
                  style={{ background: r.rank <= 6 ? PIE_COLORS[(r.rank - 1) % PIE_COLORS.length] : OTHER_COLOR }}
                >
                  {r.rank}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="tabular-nums text-muted-foreground">{r.share}%</span>
                <span className="w-28 shrink-0 text-right font-medium tabular-nums">{fmtMoney(r.net)}</span>
              </li>
            ))}
            {ranking.ranked.length > 12 ? (
              <li className="pl-7 text-xs text-muted-foreground">…и ещё {ranking.ranked.length - 12}</li>
            ) : null}
            {ranking.ranked.length === 0 ? (
              <li className="text-muted-foreground">Нет положительных начислений за период</li>
            ) : null}
          </ol>
        </div>
      </section>
    </div>
  );
}
