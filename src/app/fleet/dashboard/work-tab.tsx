import { fmtInt } from "@/lib/format";
import type { WorkTabData } from "@/lib/data/dashboard";

/** Тепловая карта активности: машина × день (часы для моточасов, рейсы для самосвалов). */
export function WorkTab({ data }: { data: WorkTabData }) {
  return (
    <div className="flex flex-col gap-3">
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
      <p className="text-xs text-muted-foreground">Пустые ячейки — простой/нет записей. Провалы видны сразу.</p>
    </div>
  );
}
