"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { downloadCsv } from "@/lib/journals/csv";
import { fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePersistedState } from "./use-persisted-state";
import type { HeatBucket, HeatRow, IdleVehicle } from "@/lib/data/dashboard";

/**
 * Тепловая карта «машина × день»: наработка за период с провалом в журнал.
 *
 * Здесь намеренно не используется общий <Table> из components/ui: у карты своя
 * геометрия ячеек, двойной sticky (номер слева, итог справа) и заливка по
 * ступеням — общий каркас пришлось бы переопределять целиком.
 */

const fmtVal = (n: number) => (Number.isInteger(n) ? fmtInt(n) : n.toFixed(1));
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Заливка ступенями, а не линейно от максимума: данные карьера длиннохвостые —
 * одна машина с рекордом за день утапливала всю середину парка в бледный шум.
 * Границы — квантили ненулевых значений.
 */
const STEP_ALPHA = [16, 32, 50, 70, 92];
/** С этой насыщенности заливка тёмная — цифру пишем светлым. */
const INK_FLIP_ALPHA = 70;

interface Scale {
  bounds: number[];
  /** Насыщенность заливки для каждой ступени (длина = bounds.length + 1). */
  alphas: number[];
}

function buildScale(rows: HeatRow[]): Scale {
  const vals: number[] = [];
  for (const r of rows) for (const v of r.cells) if (v > 0) vals.push(v);
  if (vals.length === 0) return { bounds: [], alphas: [STEP_ALPHA[STEP_ALPHA.length - 1]] };
  vals.sort((a, b) => a - b);
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
  // Совпавшие границы схлопываем: на бедных данных ступеней просто меньше.
  const bounds = [q(0.2), q(0.4), q(0.6), q(0.8)].filter((v, i, a) => i === 0 || v > a[i - 1]);
  const steps = bounds.length + 1;
  const alphas = Array.from({ length: steps }, (_, i) =>
    steps === 1 ? STEP_ALPHA[STEP_ALPHA.length - 1] : STEP_ALPHA[Math.round((i * (STEP_ALPHA.length - 1)) / (steps - 1))],
  );
  return { bounds, alphas };
}

const stepOf = (v: number, bounds: number[]) => bounds.reduce((s, b) => (v > b ? s + 1 : s), 0);

const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const isWeekend = (d: string) => dow(d) === 0 || dow(d) === 6;
const isWeekStart = (d: string) => dow(d) === 1;

export function HeatTable({
  buckets,
  rows,
  idle,
  colorVar,
  unit,
  journalPath,
  periodFrom,
  periodTo,
  emptyText,
  weekly,
  csvName,
  paramPrefix,
  idleNoun,
}: {
  buckets: HeatBucket[];
  /** Машины с работой за период. */
  rows: HeatRow[];
  /** Машины без единой записи — показываются по требованию, нулевыми строками. */
  idle: IdleVehicle[];
  colorVar: string;
  unit: string;
  journalPath: string;
  periodFrom: string;
  periodTo: string;
  emptyText: string;
  /** Колонки агрегированы в недели — разметка выходных не имеет смысла. */
  weekly: boolean;
  csvName: string;
  /** Префикс query-параметров: две карты на экране не должны делить состояние. */
  paramPrefix: string;
  /** Родительный падеж множественного числа: «самосвалов», «единиц техники». */
  idleNoun: string;
}) {
  const [q, setQ] = usePersistedState(`${paramPrefix}q`, "");
  const [sort, setSort] = usePersistedState(`${paramPrefix}sort`, "total");
  const [showIdle, setShowIdle] = usePersistedState(`${paramPrefix}idle`, "0");

  const scale = useMemo(() => buildScale(rows), [rows]);

  const visible = useMemo(() => {
    const zero = buckets.map(() => 0);
    const pool: HeatRow[] =
      showIdle === "1"
        ? [...rows, ...idle.map((v) => ({ vehicle_id: v.vehicle_id, reg: v.reg, cells: zero, total: 0 }))]
        : rows;
    const needle = q.trim().toLowerCase();
    const found = needle ? pool.filter((r) => r.reg.toLowerCase().includes(needle)) : pool;
    return sort === "reg"
      ? [...found].sort((a, b) => a.reg.localeCompare(b.reg, "ru"))
      : [...found].sort((a, b) => b.total - a.total);
  }, [rows, idle, buckets, q, sort, showIdle]);

  // Итоги считаем по видимым строкам: иначе подвал противоречит тому, что на экране.
  const totals = useMemo(
    () => buckets.map((_, i) => round1(visible.reduce((s, r) => s + r.cells[i], 0))),
    [visible, buckets],
  );
  const grand = round1(totals.reduce((a, b) => a + b, 0));

  const cellStyle = (v: number) => {
    if (v <= 0) return undefined;
    const alpha = scale.alphas[stepOf(v, scale.bounds)];
    return {
      background: `color-mix(in srgb, ${colorVar} ${alpha}%, transparent)`,
      color: alpha >= INK_FLIP_ALPHA ? "var(--chart-ink-on-fill)" : "var(--foreground)",
    };
  };

  const cellHref = (r: HeatRow, i: number) =>
    `${journalPath}?vehicle=${r.vehicle_id}&period=custom&from=${buckets[i].from}&to=${buckets[i].to}`;
  const rowHref = (r: HeatRow) =>
    `${journalPath}?vehicle=${r.vehicle_id}&period=custom&from=${periodFrom}&to=${periodTo}`;

  function exportCsv() {
    downloadCsv(
      `${csvName}_${periodFrom}_${periodTo}.csv`,
      ["Машина", ...buckets.map((b) => b.label), `Итого, ${unit}`],
      visible.map((r) => [r.reg, ...r.cells, r.total]),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Панель управления над картой */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Госномер"
            aria-label="Поиск машины по госномеру"
            className="h-9 w-40 pl-8"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Порядок строк"
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="total">Сначала больше</option>
          <option value="reg">По госномеру</option>
        </select>
        {idle.length > 0 ? (
          <Button
            size="sm"
            variant={showIdle === "1" ? "default" : "outline"}
            onClick={() => setShowIdle(showIdle === "1" ? "0" : "1")}
            title="Показать в карте машины без единой записи за период"
          >
            Простаивавшие · {idle.length}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv} disabled={visible.length === 0}>
          <Download className="size-4" />
          CSV
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={Search}
            title={q.trim() ? `Машин по запросу «${q.trim()}» нет` : emptyText}
            className="border-0 p-6"
          />
        </div>
      ) : (
        <>
          {/* Узкий экран: 31 колонка не помещается — компактный список с полоской дней. */}
          <div className="flex flex-col divide-y rounded-xl border bg-card sm:hidden">
            {visible.map((r) => (
              <Link
                key={r.vehicle_id}
                href={rowHref(r)}
                className="flex items-center gap-3 px-3 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="w-24 shrink-0 truncate text-sm font-medium">{r.reg}</span>
                <span className="flex h-5 flex-1 items-stretch gap-px overflow-hidden rounded-sm bg-muted">
                  {r.cells.map((v, i) => (
                    <span key={i} className="flex-1" style={v > 0 ? cellStyle(v) : undefined} />
                  ))}
                </span>
                <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">{fmtVal(r.total)}</span>
              </Link>
            ))}
          </div>

          {/* Десктоп: полная карта «машина × день» */}
          <div className="hidden max-h-[70vh] overflow-auto rounded-xl border bg-card sm:block">
            <table className="border-collapse text-xs">
              <caption className="sr-only">
                Наработка по машинам и дням за период с {periodFrom} по {periodTo}, единица — {unit}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 top-0 z-30 bg-card px-2 py-1.5 text-left">
                    Машина
                  </th>
                  {buckets.map((b) => (
                    <th
                      key={b.from}
                      scope="col"
                      className={cn(
                        "sticky top-0 z-20 whitespace-nowrap bg-card px-1 py-1.5 font-normal",
                        !weekly && isWeekend(b.from) ? "text-muted-foreground/70" : "text-muted-foreground",
                        !weekly && isWeekStart(b.from) && "border-l border-border",
                      )}
                    >
                      {b.label}
                    </th>
                  ))}
                  <th scope="col" className="sticky right-0 top-0 z-30 border-l bg-card px-2 py-1.5 text-right">
                    Итого
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.vehicle_id} className="group">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 whitespace-nowrap bg-card px-2 py-1 text-left font-medium group-hover:bg-accent"
                    >
                      <Link
                        href={rowHref(r)}
                        className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        title={`${r.reg}: открыть журнал за период`}
                      >
                        {r.reg}
                      </Link>
                    </th>
                    {r.cells.map((v, i) => (
                      <td
                        key={i}
                        className={cn(
                          "h-7 w-8 p-0 text-center tabular-nums",
                          !weekly && isWeekStart(buckets[i].from) && "border-l border-border",
                          v <= 0 && "group-hover:bg-accent",
                        )}
                        style={cellStyle(v)}
                      >
                        {v > 0 ? (
                          <Link
                            href={cellHref(r, i)}
                            className="flex h-full w-full items-center justify-center outline-none hover:ring-2 hover:ring-inset hover:ring-foreground/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            title={`${r.reg} · ${buckets[i].label}: ${fmtVal(v)} ${unit} — открыть журнал`}
                          >
                            {fmtVal(v)}
                          </Link>
                        ) : (
                          <span
                            className="flex h-full w-full items-center justify-center"
                            title={`${r.reg} · ${buckets[i].label}: нет записей`}
                          />
                        )}
                      </td>
                    ))}
                    <td className="sticky right-0 z-10 border-l bg-card px-2 py-1 text-right font-semibold tabular-nums group-hover:bg-accent">
                      {fmtVal(r.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold">
                  <th scope="row" className="sticky left-0 z-10 bg-muted px-2 py-1.5 text-left">
                    Итого
                  </th>
                  {totals.map((v, i) => (
                    <td
                      key={i}
                      className={cn(
                        "bg-muted px-1 py-1.5 text-center tabular-nums",
                        !weekly && isWeekStart(buckets[i].from) && "border-l border-border",
                      )}
                    >
                      {v > 0 ? fmtVal(v) : ""}
                    </td>
                  ))}
                  <td className="sticky right-0 z-10 border-l bg-muted px-2 py-1.5 text-right tabular-nums">
                    {fmtVal(grand)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {/* Легенда: отдельно шкала, отдельно смысл пустой ячейки.
          Шкалы нет, когда на экране одни простаивавшие — рисовать её не от чего. */}
      {visible.length > 0 ? (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <div className={cn("flex-wrap items-center gap-x-2 gap-y-1", scale.bounds.length > 0 ? "flex" : "hidden")}>
            <span>{unit} за {weekly ? "неделю" : "день"}:</span>
            {scale.alphas.map((alpha, i) => {
              const from = i === 0 ? null : scale.bounds[i - 1];
              const to = i < scale.bounds.length ? scale.bounds[i] : null;
              const label =
                from == null && to == null ? "есть записи"
                  : from == null ? `до ${fmtVal(to!)}`
                  : to == null ? `> ${fmtVal(from)}`
                  : `${fmtVal(from)}–${fmtVal(to)}`;
              return (
                <span key={i} className="flex items-center gap-1">
                  <span
                    className="size-3 rounded-sm border border-border"
                    style={{ background: `color-mix(in srgb, ${colorVar} ${alpha}%, transparent)` }}
                  />
                  {label}
                </span>
              );
            })}
          </div>
          <p>
            Пустая ячейка — записей за этот {weekly ? "интервал" : "день"} нет.
            {idle.length > 0 && showIdle !== "1"
              ? ` Ещё ${idle.length} ${idleNoun} без записей за весь период — кнопка «Простаивавшие».`
              : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
