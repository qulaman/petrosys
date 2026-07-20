"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, ChevronDown, Package, Timer, Truck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HeatBucket, HeatRow, WorkTabData } from "@/lib/data/dashboard";

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };
const tooltipStyle = {
  background: "var(--popover)", border: "1px solid var(--border)",
  borderRadius: 8, color: "var(--popover-foreground)", fontSize: 13,
};

const fmtVal = (n: number) => (Number.isInteger(n) ? fmtInt(n) : n.toFixed(1));

function StatTile({
  label, value, sub, icon: Icon,
}: {
  label: string; value: string; sub?: string; icon: React.ElementType;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

/** Активность (часы и рейсы раздельно) + интервалы рейсов + выработка самосвалов. */
export function WorkTab({ data }: { data: WorkTabData }) {
  const singleDay = data.buckets.length === 1 && !data.weekly;
  // Интервалы: 0 — все самосвалы, дальше по машинам.
  const [intervalIdx, setIntervalIdx] = useState(0);
  const intervalGroup = data.intervals[Math.min(intervalIdx, data.intervals.length - 1)] ?? data.intervals[0];
  const colUnit = data.weekly ? "за неделю" : "за день";
  const s = data.summary;
  const maxDayTrips = Math.max(1, ...data.tripsRows.map((r) => r.total));

  return (
    <div className="flex flex-col gap-6">
      {/* Сводка периода */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Рейсов за период" value={fmtInt(s.tripsTotal)} icon={Truck} />
        <StatTile label="Моточасов за период" value={fmtInt(s.hoursTotal)} icon={Timer} />
        <StatTile label="Работало техники" value={`${s.worked}/${s.fleet}`} icon={Activity}
          sub={s.idle > 0 ? `простаивало ${s.idle}` : "весь парк в работе"} />
        <StatTile label="Перевезено грунта" value={s.m3Total != null ? `${fmtInt(s.m3Total)} м³` : "—"} icon={Package}
          sub={s.m3Total != null ? "по объёмам маршрутов" : "объёмы маршрутов не заполнены"} />
      </div>

      {/* Моточасы */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          Моточасы <span className="text-muted-foreground">(часов {colUnit} · клик — в табель)</span>
        </h3>
        <HeatTable
          buckets={data.buckets}
          rows={data.hoursRows}
          dayTotals={data.hoursDayTotals}
          maxCell={data.maxHoursCell}
          colorVar="var(--chart-card)"
          unit="ч"
          journalPath="/fleet/journals/shifts"
          periodFrom={data.periodFrom}
          periodTo={data.periodTo}
          emptyText="Нет техники на моточасах с работой за период"
        />
        <IdleList regs={data.hoursIdleRegs} noun="единиц техники на моточасах" />
      </section>

      {/* Рейсы */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">
          Рейсы самосвалов{" "}
          <span className="text-muted-foreground">
            {singleDay ? "(за день · клик — в журнал рейсов)" : `(рейсов ${colUnit} · клик — в журнал рейсов)`}
          </span>
        </h3>
        {singleDay ? (
          <div className="flex flex-col gap-2 rounded-lg border p-4">
            {data.tripsRows.map((r) => (
              <Link
                key={r.vehicle_id}
                href={`/fleet/journals/trips?vehicle=${r.vehicle_id}&period=custom&from=${data.periodFrom}&to=${data.periodTo}`}
                className="flex items-center gap-3 rounded px-1 hover:bg-accent"
                title={`${r.reg}: ${r.total} рейсов — открыть журнал`}
              >
                <span className="w-24 shrink-0 text-sm font-medium">{r.reg}</span>
                <div className="h-3 flex-1 rounded bg-muted">
                  <div className="h-full rounded" style={{ width: `${(r.total / maxDayTrips) * 100}%`, background: "var(--chart-tanker)" }} />
                </div>
                <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">{fmtInt(r.total)}</span>
              </Link>
            ))}
            {data.tripsRows.length === 0 ? (
              <EmptyState icon={Truck} title="Рейсов за день нет" className="border-0 p-4" />
            ) : null}
          </div>
        ) : (
          <HeatTable
            buckets={data.buckets}
            rows={data.tripsRows}
            dayTotals={data.tripsDayTotals}
            maxCell={data.maxTripsCell}
            colorVar="var(--chart-tanker)"
            unit="рейсов"
            journalPath="/fleet/journals/trips"
            periodFrom={data.periodFrom}
            periodTo={data.periodTo}
            emptyText="Нет самосвалов с рейсами за период"
          />
        )}
        <IdleList regs={data.tripsIdleRegs} noun="самосвалов" />
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
                <Bar dataKey="count" name="Ходок" fill="var(--chart-card)" radius={[4, 4, 0, 0]} />
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
                <Bar dataKey="avgPerDay" name="Рейсов/день" fill="var(--chart-tanker)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground">Пунктир — медиана парка: отстающие и лидеры видны сразу.</p>
        </section>
      </div>
    </div>
  );
}

/** Раскрываемый список простаивавшей техники — сигнал, а не пустые строки в таблице. */
function IdleList({ regs, noun }: { regs: string[]; noun: string }) {
  const [open, setOpen] = useState(false);
  if (regs.length === 0) return null;
  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-4 transition-transform", open ? "rotate-180" : "")} />
        Не работали за период: {regs.length} {noun}
      </button>
      {open ? <p className="mt-1 text-xs text-muted-foreground">{regs.join(", ")}</p> : null}
    </div>
  );
}

function HeatTable({
  buckets,
  rows,
  dayTotals,
  maxCell,
  colorVar,
  unit,
  journalPath,
  periodFrom,
  periodTo,
  emptyText,
}: {
  buckets: HeatBucket[];
  rows: HeatRow[];
  dayTotals: number[];
  maxCell: number;
  colorVar: string;
  unit: string;
  journalPath: string;
  periodFrom: string;
  periodTo: string;
  emptyText: string;
}) {
  const cellBg = (v: number) =>
    v > 0 ? `color-mix(in srgb, ${colorVar} ${Math.round((v / maxCell) * 85) + 15}%, transparent)` : "transparent";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-background px-2 py-1 text-left">Машина</th>
              {buckets.map((b) => (
                <th key={b.from} className="sticky top-0 z-10 bg-background px-1 py-1 font-normal text-muted-foreground">{b.label}</th>
              ))}
              <th className="sticky top-0 z-10 bg-background px-2 py-1 text-right">Итого</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.vehicle_id}>
                <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-2 py-1 font-medium">
                  <Link
                    href={`${journalPath}?vehicle=${r.vehicle_id}&period=custom&from=${periodFrom}&to=${periodTo}`}
                    className="hover:underline"
                    title={`${r.reg}: открыть журнал за период`}
                  >
                    {r.reg}
                  </Link>
                </td>
                {r.cells.map((v, i) => (
                  <td
                    key={i}
                    className="h-7 w-8 p-0 text-center tabular-nums"
                    style={{
                      background: cellBg(v),
                      color: v / maxCell > 0.6 ? "#fff" : "var(--foreground)",
                    }}
                  >
                    {v > 0 ? (
                      <Link
                        href={`${journalPath}?vehicle=${r.vehicle_id}&period=custom&from=${buckets[i].from}&to=${buckets[i].to}`}
                        className="flex h-full w-full items-center justify-center"
                        title={`${r.reg} · ${buckets[i].label}: ${fmtVal(v)} ${unit}`}
                      >
                        {fmtVal(v)}
                      </Link>
                    ) : (
                      <span title={`${r.reg} · ${buckets[i].label}: нет записей`} className="flex h-full w-full items-center justify-center" />
                    )}
                  </td>
                ))}
                <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmtVal(r.total)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={buckets.length + 2}><EmptyState icon={Timer} title={emptyText} className="border-0 p-6" /></td></tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              <tr className="border-t bg-muted/50 font-semibold">
                <td className="sticky left-0 z-10 bg-muted px-2 py-1">Итого</td>
                {dayTotals.map((v, i) => (
                  <td key={i} className="px-1 py-1 text-center tabular-nums">{v > 0 ? fmtVal(v) : ""}</td>
                ))}
                <td className="px-2 py-1 text-right tabular-nums">
                  {fmtVal(Math.round(dayTotals.reduce((a, b) => a + b, 0) * 10) / 10)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {rows.length > 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>0</span>
          <span
            className="h-2 w-24 rounded"
            style={{ background: `linear-gradient(to right, color-mix(in srgb, ${colorVar} 15%, transparent), ${colorVar})` }}
          />
          <span>{fmtVal(maxCell)} {unit} — пустая ячейка: простой/нет записей</span>
        </div>
      ) : null}
    </div>
  );
}
