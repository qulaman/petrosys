"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Area, AreaChart, CartesianGrid, Cell, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, ArrowDown as ArrowDownIcon, ArrowUp as ArrowUpIcon, ChevronDown, Coins, Download, Fuel, Gavel, TrendingUp, Wallet } from "lucide-react";
import { fmtMoney, fmtInt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
import { downloadCsv } from "@/lib/journals/csv";
import { vehicleTypeLabel } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { EffectiveCostRow, MoneyTabData } from "@/lib/data/dashboard";

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

type EffKey = "contractor" | "trips" | "costPerTrip" | "hours" | "costPerHour" | "tengePerM3";

const EFF_COLUMNS: { key: EffKey; label: string; numeric: boolean; hint: string }[] = [
  { key: "contractor", label: "Подрядчик · договор", numeric: false, hint: "" },
  { key: "trips", label: "Рейсов", numeric: true, hint: "Оплачено / всего за период. Если числа расходятся — часть рейсов без ставки в прайсе договора, они не оплачиваются и в стоимость рейса не входят." },
  { key: "costPerTrip", label: "₸/рейс", numeric: true, hint: "Начислено за рейсы минус удержанный ГСМ, делённое на число ОПЛАЧЕННЫХ рейсов. Часовые начисления и штрафы сюда не входят." },
  { key: "hours", label: "Часов", numeric: true, hint: "Оплачено / всего за период. Считаются только смены из закрытых журналов — черновики не оплачиваются." },
  { key: "costPerHour", label: "₸/час", numeric: true, hint: "Начислено за моточасы минус удержанный ГСМ, делённое на число ОПЛАЧЕННЫХ часов. Рейсовые начисления и штрафы сюда не входят." },
  { key: "tengePerM3", label: "₸/м³ грунта", numeric: true, hint: "" },
];

/** Медиана по парку — база сравнения; на выборке меньше 3 значений бессмысленна. */
const MIN_FOR_MEDIAN = 3;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Отклонение от медианы своего вида техники: дешевле — зелёное, дороже — тревожное. */
function Deviation({ value, med, sample }: { value: number | null; med: number | null; sample: number }) {
  if (value == null || med == null || med <= 0 || sample < MIN_FOR_MEDIAN) return null;
  const d = Math.round(((value - med) / med) * 100);
  if (d === 0) return null;
  const cls = d >= 30 ? "text-destructive" : d >= 15 ? "text-warning" : d <= -15 ? "text-success" : "text-muted-foreground";
  return <span className={cn("ml-1 text-[11px] font-normal tabular-nums", cls)}>{d > 0 ? "+" : ""}{d}%</span>;
}

/** Количество как «оплачено / всего»: расхождение — это дыра в прайсе договора. */
function QtyCell({ total, billed }: { total: number; billed: number }) {
  if (total <= 0) return <span className="text-muted-foreground">—</span>;
  if (billed >= total) return <>{fmtInt(total)}</>;
  return (
    <>
      {fmtInt(billed)} <span className="text-muted-foreground">/ {fmtInt(total)}</span>
    </>
  );
}

/**
 * Метрика или причина её отсутствия. Прочерк раньше означал три разные вещи —
 * теперь «работы такого типа не было» и «работа есть, а ставки нет» различимы:
 * второе — потеря денег, и ведёт прямо в прайс договора.
 */
function MetricCell({ value, qty, contractId }: { value: number | null; qty: number; contractId: string }) {
  if (value != null) return <>{fmtMoney(value)}</>;
  if (qty <= 0) return <span className="font-normal text-muted-foreground">—</span>;
  return (
    <Link
      href={`/fleet/admin/contracts/${contractId}`}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning hover:bg-warning/20"
      title="Открыть договор — добавить ставку в прайс"
    >
      <span className="size-1.5 rounded-full bg-current" />
      нет ставки
    </Link>
  );
}

export function MoneyTab({ data }: { data: MoneyTabData }) {
  const sp = useSearchParams();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "net", desc: true });
  const [effSort, setEffSort] = useState<{ key: EffKey; desc: boolean }>({ key: "contractor", desc: false });
  const [unbilledOpen, setUnbilledOpen] = useState(false);

  const settlementHref = (c: { id: string }) => {
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

  // Эффективная стоимость: группы по виду техники, внутри — своя сортировка.
  // Медиана считается ВНУТРИ вида: сравнивать экскаватор с катком нельзя.
  const effGroups = useMemo(() => {
    const byType = new Map<string, EffectiveCostRow[]>();
    for (const r of data.effective) {
      (byType.get(r.vehicleType) ?? byType.set(r.vehicleType, []).get(r.vehicleType))!.push(r);
    }
    const { key, desc } = effSort;
    return [...byType.entries()]
      .map(([vehicleType, group]) => {
        const pick = (k: "costPerTrip" | "costPerHour" | "tengePerM3") =>
          group.map((r) => r[k]).filter((n): n is number => n != null);
        const rows = [...group].sort((a, b) => {
          if (key === "contractor") {
            const c = a.contractor.localeCompare(b.contractor, "ru") || a.number.localeCompare(b.number, "ru");
            return desc ? -c : c;
          }
          const av = a[key];
          const bv = b[key];
          if (av == null || av === 0) return bv == null || bv === 0 ? 0 : 1; // пустые всегда снизу
          if (bv == null || bv === 0) return -1;
          return desc ? bv - av : av - bv;
        });
        return {
          vehicleType,
          rows,
          med: {
            costPerTrip: median(pick("costPerTrip")),
            costPerHour: median(pick("costPerHour")),
            tengePerM3: median(pick("tengePerM3")),
          },
          n: {
            costPerTrip: pick("costPerTrip").length,
            costPerHour: pick("costPerHour").length,
            tengePerM3: pick("tengePerM3").length,
          },
        };
      })
      .sort((a, b) => vehicleTypeLabel(a.vehicleType).localeCompare(vehicleTypeLabel(b.vehicleType), "ru"));
  }, [data.effective, effSort]);

  const exportEffectiveCsv = () =>
    downloadCsv(
      "эффективная-стоимость.csv",
      ["Подрядчик", "Договор", "Вид техники", "Рейсов оплачено", "Рейсов всего", "₸/рейс",
        "Часов оплачено", "Часов всего", "₸/час", "м³ оплачено", "₸/м³"],
      data.effective.map((r) => [
        r.contractor, r.number, vehicleTypeLabel(r.vehicleType),
        r.billedTrips, r.trips, r.costPerTrip ?? "",
        r.billedHours, r.hours, r.costPerHour ?? "",
        r.billedVolume, r.tengePerM3 ?? "",
      ]),
    );

  const toggleEffSort = (key: EffKey) =>
    setEffSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: key !== "contractor" }));

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
          <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-4">
            <button type="button" onClick={() => setUnbilledOpen((v) => !v)} className="flex items-center gap-2 text-left">
              <AlertTriangle className="size-5 shrink-0 text-warning" />
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
                              : "border-warning/30 bg-warning/10 text-warning",
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
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Эффективная стоимость</h3>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Во что фактически обходится рейс и моточас у каждого подрядчика после удержания ГСМ.
              Строки сгруппированы по виду техники и сравниваются с медианой своей группы — база для пересмотра ставок.
            </p>
          </div>
          {data.effective.length > 0 ? (
            <Button variant="outline" size="sm" onClick={exportEffectiveCsv}>
              <Download className="size-4" /> CSV
            </Button>
          ) : null}
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            {/* Шапка непрозрачная (bg-muted, не /50): под sticky-колонкой при
                горизонтальном скролле не должно просвечивать содержимое. */}
            <thead className="bg-muted text-left">
              <tr>
                {EFF_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "whitespace-nowrap px-3 py-2",
                      col.numeric && "text-right",
                      col.key === "contractor" && "sticky left-0 z-10 bg-muted",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleEffSort(col.key)}
                      className={cn("inline-flex items-center gap-1 hover:text-foreground", effSort.key === col.key ? "text-foreground" : "")}
                      title="Сортировать внутри вида техники"
                    >
                      {col.label}
                      {effSort.key === col.key ? (effSort.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />) : null}
                    </button>
                    {col.key === "tengePerM3" ? (
                      <InfoHint text={data.volumesFilled
                        ? "Рейсовая часть «к оплате», делённая на кубометры перевезённого грунта. Объём рейса берётся из маршрута."
                        : "Метрика не считается: в справочнике маршрутов не заполнены объёмы (м³ за рейс). Заполните их — колонка оживёт без других правок."} />
                    ) : col.hint ? (
                      <InfoHint text={col.hint} />
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            {effGroups.map((g) => (
              <tbody key={g.vehicleType} className="divide-y border-t">
                <tr className="bg-muted/40">
                  <td className="sticky left-0 z-10 bg-muted/40 px-3 py-1.5 font-medium" colSpan={2}>
                    {vehicleTypeLabel(g.vehicleType)}
                    <span className="ml-1.5 font-normal text-muted-foreground">· {g.rows.length} {g.rows.length === 1 ? "договор" : "договоров"}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
                    {g.n.costPerTrip >= MIN_FOR_MEDIAN ? `медиана ${fmtMoney(g.med.costPerTrip!)}` : null}
                  </td>
                  <td className="px-3 py-1.5" />
                  <td className="px-3 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
                    {g.n.costPerHour >= MIN_FOR_MEDIAN ? `медиана ${fmtMoney(g.med.costPerHour!)}` : null}
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs text-muted-foreground tabular-nums">
                    {g.n.tengePerM3 >= MIN_FOR_MEDIAN ? `медиана ${fmtMoney(g.med.tengePerM3!)}` : null}
                  </td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={`${r.contractId}|${r.vehicleType}`} className="hover:bg-accent/40">
                    <td className="sticky left-0 z-10 bg-background px-3 py-2">
                      <Link href={settlementHref({ id: r.contractId })} className="hover:underline">
                        {r.contractor} <span className="text-muted-foreground">· {r.number}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums"><QtyCell total={r.trips} billed={r.billedTrips} /></td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      <MetricCell value={r.costPerTrip} qty={r.trips} contractId={r.contractId} />
                      <Deviation value={r.costPerTrip} med={g.med.costPerTrip} sample={g.n.costPerTrip} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums"><QtyCell total={r.hours} billed={r.billedHours} /></td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      <MetricCell value={r.costPerHour} qty={r.hours} contractId={r.contractId} />
                      <Deviation value={r.costPerHour} med={g.med.costPerHour} sample={g.n.costPerHour} />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {r.tengePerM3 != null ? fmtMoney(r.tengePerM3) : <span className="font-normal text-muted-foreground">—</span>}
                      <Deviation value={r.tengePerM3} med={g.med.tengePerM3} sample={g.n.tengePerM3} />
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
            {effGroups.length === 0 ? (
              <tbody>
                <tr><td colSpan={6}><EmptyState icon={Wallet} title="Нет работ за период" className="border-0 p-6" /></td></tr>
              </tbody>
            ) : null}
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Количества показаны как «оплачено / всего» — в стоимость входит только тарифицированная работа.
          Удержанный ГСМ разнесён между рейсовой и часовой частью пропорционально начислению.
          Штрафы в эффективную стоимость не входят: это не себестоимость рейса — они учтены в таблице «к оплате» выше.
          Процент рядом со ставкой — отклонение от медианы своего вида техники (показывается от {MIN_FOR_MEDIAN} договоров в группе).
        </p>
        {!data.volumesFilled ? (
          <p className="text-xs text-muted-foreground">
            Колонка ₸/м³ пуста: не заполнены объёмы маршрутов.{" "}
            <Link href="/fleet/admin/routes" className="underline hover:text-foreground">Заполнить объёмы</Link> — и себестоимость куба посчитается за прошлые периоды тоже.
          </p>
        ) : null}
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
