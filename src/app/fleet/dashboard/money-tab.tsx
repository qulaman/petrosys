import { fmtMoney } from "@/lib/format";
import type { MoneyTabData } from "@/lib/data/dashboard";

export function MoneyTab({ data }: { data: MoneyTabData }) {
  const totalForecast = data.contracts.reduce((s, c) => s + c.forecast, 0);
  const maxNet = Math.max(1, ...data.contracts.map((c) => Math.abs(c.net)));

  return (
    <div className="flex flex-col gap-5">
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

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Доля «к оплате» по договорам</h3>
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
  );
}
