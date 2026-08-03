"use client";

import Link from "next/link";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, AlertTriangle, Package, Timer, Truck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchSelect } from "@/components/ui/search-select";
import { Delta } from "@/components/dashboard/delta";
import { HeatTable } from "@/components/dashboard/heat-table";
import { Panel, Section } from "@/components/dashboard/section";
import { StatTile } from "@/components/dashboard/stat-tile";
import { axisTick, tooltipStyle } from "@/components/dashboard/chart-theme";
import { usePersistedState } from "@/components/dashboard/use-persisted-state";
import { fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HeatRow, WorkTabData } from "@/lib/data/dashboard";

/** Первая корзина гистограммы: интервал быстрее физически возможного. */
const SUSPICIOUS_BUCKET = "<15";
/** Отстающими считаем тех, кто заметно ниже медианы, а не всю нижнюю половину. */
const LAG_RATIO = 0.8;

/** Активность (часы и рейсы раздельно) + интервалы рейсов + выработка самосвалов. */
export function WorkTab({ data }: { data: WorkTabData }) {
  const singleDay = data.buckets.length === 1 && !data.weekly;
  const s = data.summary;
  const periodQ = `period=custom&from=${data.periodFrom}&to=${data.periodTo}`;

  // Машина для гистограммы интервалов: 0 — все самосвалы, дальше по машинам.
  const [intervalKey, setIntervalKey] = usePersistedState("iv", "");
  const intervalIdx = Math.max(0, data.intervals.findIndex((g) => (g.reg ?? "") === intervalKey));
  const intervalGroup = data.intervals[intervalIdx] ?? data.intervals[0];
  const suspicious = intervalGroup?.buckets.find((b) => b.label === SUSPICIOUS_BUCKET)?.count ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Сводка периода */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Рейсов за период"
          value={fmtInt(s.tripsTotal)}
          icon={Truck}
          href={`/fleet/journals/trips?${periodQ}`}
          title="Открыть журнал рейсов за период"
          delta={<Delta now={s.tripsTotal} prev={data.prev.trips} suffix={`к ${data.prev.label}`}
            title="База сравнения — прошедшая часть предыдущего периода" />}
        />
        <StatTile
          label="Моточасов за период"
          value={fmtInt(s.hoursTotal)}
          icon={Timer}
          href={`/fleet/journals/shifts?${periodQ}`}
          title="Открыть табель за период"
          delta={<Delta now={s.hoursTotal} prev={data.prev.hours} suffix={`к ${data.prev.label}`}
            title="База сравнения — прошедшая часть предыдущего периода" />}
        />
        <StatTile
          label="Работало техники"
          value={`${s.worked}/${s.fleet}`}
          icon={Activity}
          tone={s.idle > 0 ? "warning" : "success"}
          sub={s.idle > 0 ? `${s.idle} без единой записи за период` : "весь парк в работе"}
        />
        <StatTile
          label="Перевезено грунта"
          value={s.m3Total != null ? `${fmtInt(s.m3Total)} м³` : "—"}
          icon={Package}
          sub={
            s.m3Total != null ? (
              "по объёмам маршрутов"
            ) : (
              <>
                у маршрутов не заполнен объём —{" "}
                <Link href="/fleet/admin/routes" className="underline hover:text-foreground">
                  заполнить в справочнике
                </Link>
              </>
            )
          }
        />
      </div>

      {/* Моточасы */}
      <Section
        title="Моточасы"
        hint={singleDay ? "(часов за день · клик — в табель)" : `(часов за ${data.weekly ? "неделю" : "день"} · клик — в табель)`}
      >
        {singleDay ? (
          <DayBars
            rows={data.hoursRows}
            colorVar="var(--chart-card)"
            journalPath="/fleet/journals/shifts"
            periodQ={periodQ}
            unit="ч"
            emptyIcon={Timer}
            emptyText="Часов за день нет"
          />
        ) : (
          <HeatTable
            buckets={data.buckets}
            rows={data.hoursRows}
            idle={data.hoursIdle}
            colorVar="var(--chart-card)"
            unit="ч"
            journalPath="/fleet/journals/shifts"
            periodFrom={data.periodFrom}
            periodTo={data.periodTo}
            emptyText="Нет техники на моточасах с работой за период"
            weekly={data.weekly}
            csvName="motochasy"
            paramPrefix="h"
            idleNoun="ед. техники"
          />
        )}
      </Section>

      {/* Рейсы */}
      <Section
        title="Рейсы самосвалов"
        hint={singleDay ? "(за день · клик — в журнал рейсов)" : `(рейсов за ${data.weekly ? "неделю" : "день"} · клик — в журнал рейсов)`}
      >
        {singleDay ? (
          <DayBars
            rows={data.tripsRows}
            colorVar="var(--chart-tanker)"
            journalPath="/fleet/journals/trips"
            periodQ={periodQ}
            unit="рейсов"
            emptyIcon={Truck}
            emptyText="Рейсов за день нет"
          />
        ) : (
          <HeatTable
            buckets={data.buckets}
            rows={data.tripsRows}
            idle={data.tripsIdle}
            colorVar="var(--chart-tanker)"
            unit="рейсов"
            journalPath="/fleet/journals/trips"
            periodFrom={data.periodFrom}
            periodTo={data.periodTo}
            emptyText="Нет самосвалов с рейсами за период"
            weekly={data.weekly}
            csvName="reisy"
            paramPrefix="t"
            idleNoun="самосвалов"
          />
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Гистограмма интервалов */}
        <Section
          title="Интервалы между рейсами, мин"
          hint={intervalGroup?.median != null ? `· медиана ${intervalGroup.median} мин` : undefined}
          description="Столбец «<15» — ходки быстрее физически возможного: рейс мог быть отмечен дважды или накручен."
          actions={
            data.intervals.length > 1 ? (
              <SearchSelect
                value={intervalKey}
                onChange={setIntervalKey}
                options={data.intervals.filter((g) => g.reg).map((g) => ({ value: g.reg!, label: g.reg! }))}
                emptyLabel="Все самосвалы"
                placeholder="Госномер"
                className="w-44"
              />
            ) : null
          }
        >
          <Panel className="h-56 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={intervalGroup?.buckets ?? []} margin={{ top: 8, right: 8, bottom: 16, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }}
                  formatter={(v) => fmtInt(Number(v))} />
                <Bar dataKey="count" name="Интервалов" radius={[4, 4, 0, 0]}>
                  {(intervalGroup?.buckets ?? []).map((b) => (
                    // Подозрительная корзина — предупреждающим цветом, остальные нейтральны.
                    <Cell key={b.label} fill={b.label === SUSPICIOUS_BUCKET ? "var(--chart-over)" : "var(--chart-card)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          {suspicious > 0 ? (
            <Link
              href="/fleet/dashboard/anomalies?type=short_trip_interval"
              className="flex w-fit items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning hover:bg-warning/20"
            >
              <AlertTriangle className="size-3.5" />
              Подозрительных интервалов: {fmtInt(suspicious)} — разобрать в центре аномалий
            </Link>
          ) : null}
        </Section>

        {/* Выработка самосвалов */}
        <Productivity data={data} />
      </div>
    </div>
  );
}

/**
 * Однодневный период: 31 колонки нет, показывать одноколоночную карту незачем —
 * обе секции рисуются горизонтальными барами.
 */
function DayBars({
  rows, colorVar, journalPath, periodQ, unit, emptyIcon, emptyText,
}: {
  rows: HeatRow[];
  colorVar: string;
  journalPath: string;
  periodQ: string;
  unit: string;
  emptyIcon: React.ElementType;
  emptyText: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  if (rows.length === 0) {
    return (
      <Panel padded={false}>
        <EmptyState icon={emptyIcon} title={emptyText} className="border-0 p-6" />
      </Panel>
    );
  }
  return (
    <Panel className="flex max-h-[70vh] flex-col gap-2 overflow-auto">
      {rows.map((r) => (
        <Link
          key={r.vehicle_id}
          href={`${journalPath}?vehicle=${r.vehicle_id}&${periodQ}`}
          className="flex items-center gap-3 rounded px-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          title={`${r.reg}: ${r.total} ${unit} — открыть журнал`}
        >
          <span className="w-24 shrink-0 truncate text-sm font-medium">{r.reg}</span>
          <span className="h-3 flex-1 rounded bg-muted">
            <span className="block h-full rounded" style={{ width: `${(r.total / max) * 100}%`, background: colorVar }} />
          </span>
          <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">{r.total}</span>
        </Link>
      ))}
    </Panel>
  );
}

/**
 * Выработка самосвалов горизонтальными строками: госномера на оси X
 * вертикального графика схлопывались в нечитаемую кашу уже на паре десятков машин.
 */
function Productivity({ data }: { data: WorkTabData }) {
  const med = data.productivityMedian;
  const max = Math.max(1, ...data.productivity.map((p) => p.avgPerDay));
  const lagging = med != null ? data.productivity.filter((p) => p.avgPerDay < med * LAG_RATIO).length : 0;

  return (
    <Section
      title="Выработка самосвалов, рейсов/день"
      hint={med != null ? `· медиана парка ${med}` : undefined}
      description={
        med != null
          ? `Метка на дорожке — медиана парка. Отстающими подсвечены машины ниже ${Math.round(LAG_RATIO * 100)}% медианы${lagging > 0 ? `: ${lagging}` : ""}.`
          : "Среднее число рейсов за день, когда машина работала."
      }
    >
      {data.productivity.length === 0 ? (
        <Panel padded={false}>
          <EmptyState icon={Truck} title="Нет самосвалов с рейсами за период" className="border-0 p-6" />
        </Panel>
      ) : (
        <Panel className="flex max-h-[22rem] flex-col gap-2.5 overflow-auto">
          {data.productivity.map((p) => {
            const lag = med != null && p.avgPerDay < med * LAG_RATIO;
            const medPos = med != null ? Math.min((med / max) * 100, 100) : null;
            return (
              <Link
                key={p.vehicle_id}
                href={`/fleet/journals/trips?vehicle=${p.vehicle_id}&period=custom&from=${data.periodFrom}&to=${data.periodTo}`}
                className="flex flex-col gap-1 rounded px-1 py-0.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                title={`${p.reg}: ${p.avgPerDay} рейсов/день — открыть журнал`}
              >
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{p.reg}</span>
                  <span className={cn("shrink-0 tabular-nums", lag ? "font-semibold text-warning" : "")}>
                    {p.avgPerDay}
                  </span>
                </div>
                <span className="relative block h-2.5 rounded bg-muted">
                  <span
                    className="absolute inset-y-0 left-0 rounded"
                    style={{ width: `${(p.avgPerDay / max) * 100}%`, background: lag ? "var(--warning)" : "var(--chart-tanker)" }}
                  />
                  {medPos != null ? (
                    <span className="absolute -top-0.5 h-3.5 w-0.5 bg-foreground/60" style={{ left: `${medPos}%` }} />
                  ) : null}
                </span>
              </Link>
            );
          })}
        </Panel>
      )}
    </Section>
  );
}
