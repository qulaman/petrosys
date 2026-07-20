"use client";

import { useState } from "react";
import Link from "next/link";
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
import { AlertTriangle, ChevronDown, Droplet, Fuel, Gauge, Truck, Wallet } from "lucide-react";
import { useNavProgress } from "@/components/nav-progress";
import { EmptyState } from "@/components/ui/empty-state";
import { fmtInt, fmtLiters, fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DailyIssue, FuelTabData } from "@/lib/data/dashboard";

const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };
const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 13,
};

/** Позиция риск-линии нормы на шкале бара: норма = 70 % ширины, дальше — зона перерасхода. */
const NORM_POS = 70;

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

export function FuelTab({ data }: { data: FuelTabData }) {
  const nav = useNavProgress();
  const [overOnly, setOverOnly] = useState(false);
  const [noNormOpen, setNoNormOpen] = useState(false);

  const s = data.summary;
  const maxTop = Math.max(1, ...data.top.map((t) => t.liters));
  const normRows = overOnly ? data.norm.filter((n) => n.overPct > 0) : data.norm;

  // Клик по дню — журнал ГСМ за этот день.
  const openDay = (state: unknown) => {
    const d = (state as { activePayload?: { payload?: DailyIssue }[] } | null)?.activePayload?.[0]?.payload;
    if (d?.date) nav.push(`/fleet/journals/fuel?period=custom&from=${d.date}&to=${d.date}`);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Сводка периода */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Выдано всего" value={fmtLiters(s.totalLiters)} icon={Fuel}
          sub={`карта ${fmtInt(s.litersCard)} · бензовоз ${fmtInt(s.litersTanker)}`} />
        <StatTile label="Машин заправлено" value={fmtInt(s.vehiclesFueled)} icon={Truck} />
        <StatTile label="Удержания за ГСМ" value={fmtMoney(s.fuelHoldTenge)} icon={Wallet}
          sub="по ценам договоров" />
        <StatTile label="Превышения нормы" value={s.normFilled ? fmtInt(s.overCount) : "—"} icon={Gauge}
          sub={s.normFilled ? "машин выше норматива" : "нормативы не заполнены"} />
      </div>

      {/* Выдачи по дням */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          Выдачи топлива по дням, л <span className="text-muted-foreground">· клик по дню — журнал выдач</span>
        </h3>
        <div className="h-64 w-full rounded-lg border p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              onClick={openDay} className="cursor-pointer">
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={16} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
              <Legend formatter={(v) => <span style={{ color: "var(--foreground)", fontSize: 12 }}>{v}</span>} />
              <Bar dataKey="card" name="Карта" stackId="a" fill="var(--chart-card)" stroke="var(--background)" strokeWidth={1} />
              <Bar dataKey="tanker" name="Бензовоз" stackId="a" fill="var(--chart-tanker)" stroke="var(--background)" strokeWidth={1} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Расход к нормативу */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">
            Расход к нормативу, л/моточас <span className="text-muted-foreground">(риск-линия — норма договора)</span>
          </h3>
          {s.overCount > 0 ? (
            <button
              type="button"
              onClick={() => setOverOnly((v) => !v)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium",
                overOnly ? "bg-accent" : "hover:bg-accent",
              )}
            >
              Только превышения ({s.overCount})
            </button>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          {normRows.map((n) => {
            const over = n.overPct > 0;
            const width = Math.min((n.actual / n.norm) * NORM_POS, 100);
            return (
              <div key={n.vehicle_id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <Link
                    href={`/fleet/journals/fuel?vehicle=${n.vehicle_id}`}
                    className="font-medium hover:underline"
                    title="Открыть журнал выдач этой машины"
                  >
                    {n.reg}
                  </Link>
                  <span className="tabular-nums">
                    {n.actual} л/ч · норма {n.norm}{" "}
                    <span className={cn("font-semibold", over ? "text-destructive" : "text-muted-foreground")}>
                      {over ? `+${n.overPct}%` : `${n.overPct}%`}
                    </span>
                  </span>
                </div>
                <div className="relative h-3 rounded bg-muted" title={`${n.actual} л/ч при норме ${n.norm}`}>
                  <div
                    className="absolute h-full rounded"
                    style={{ width: `${width}%`, background: over ? "var(--chart-over)" : "var(--chart-ok)" }}
                  />
                  <div
                    className="absolute -top-0.5 h-4 w-0.5 bg-foreground"
                    style={{ left: `${NORM_POS}%` }}
                    title={`норма ${n.norm} л/ч`}
                  />
                </div>
              </div>
            );
          })}
          {normRows.length === 0 ? (
            s.normFilled ? (
              <EmptyState icon={Gauge} title={overOnly ? "Превышений нет" : "Нет данных по моточасам за период"} className="border-0 p-4" />
            ) : (
              <EmptyState
                icon={Gauge}
                title="Нормативы расхода не заполнены"
                description="Заполните «Норма топлива, л/моточас» в карточках техники — появится контроль перерасхода, аномалии и претензии."
                action={
                  <Link href="/fleet/admin/vehicles" className="text-sm text-primary underline">
                    Открыть справочник техники
                  </Link>
                }
                className="border-0 p-4"
              />
            )
          ) : null}

          {data.noNormRegs.length > 0 ? (
            <div className="border-t pt-2 text-sm">
              <button
                type="button"
                onClick={() => setNoNormOpen((v) => !v)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={cn("size-4 transition-transform", noNormOpen ? "rotate-180" : "")} />
                Без норматива: {data.noNormRegs.length}{" "}
                {data.noNormRegs.length === 1 ? "машина" : data.noNormRegs.length < 5 ? "машины" : "машин"}
              </button>
              {noNormOpen ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {data.noNormRegs.join(", ")} —{" "}
                  <Link href="/fleet/admin/vehicles" className="text-primary underline">
                    заполнить в справочнике
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Топ потребителей */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            Топ потребителей топлива{" "}
            <span className="text-muted-foreground">
              ({Math.min(10, s.vehiclesFueled)} из {s.vehiclesFueled})
            </span>
          </h3>
          <div className="flex flex-col gap-2 rounded-lg border p-4">
            {data.top.map((t) => {
              const share = s.totalLiters > 0 ? Math.round((t.liters / s.totalLiters) * 100) : 0;
              return (
                <Link
                  key={t.vehicle_id}
                  href={`/fleet/journals/fuel?vehicle=${t.vehicle_id}`}
                  className="flex items-center gap-3 rounded px-1 hover:bg-accent"
                  title="Открыть журнал выдач этой машины"
                >
                  <span className="flex w-24 shrink-0 items-center gap-1 text-sm font-medium">
                    {t.reg}
                    {t.attention ? (
                      <AlertTriangle className="size-3.5 shrink-0 text-amber-600" aria-label="Есть открытая аномалия" />
                    ) : null}
                  </span>
                  <div className="h-3 flex-1 rounded bg-muted">
                    <div className="h-full rounded" style={{ width: `${(t.liters / maxTop) * 100}%`, background: "var(--chart-card)" }} />
                  </div>
                  <span className="w-32 shrink-0 text-right text-sm tabular-nums">
                    {fmtLiters(t.liters)} <span className="text-muted-foreground">· {share}%</span>
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {t.perHour != null ? `${t.perHour} л/ч` : ""}
                  </span>
                </Link>
              );
            })}
            {data.top.length === 0 ? (
              <EmptyState icon={Droplet} title="Выдач за период нет" className="border-0 p-4" />
            ) : null}
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
    </div>
  );
}
