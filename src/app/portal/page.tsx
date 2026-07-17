import { PortalShell } from "@/components/portal-shell";
import { PeriodSelector } from "@/components/period-selector";
import { resolvePeriod } from "@/lib/journals/period";
import { loadMoneyTabData } from "@/lib/data/dashboard";
import { fmtMoney } from "@/lib/format";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PortalHome({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const period = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) });
  const money = await loadMoneyTabData(period);

  return (
    <PortalShell title="Мои начисления">
      <div className="flex flex-col gap-4">
        <PeriodSelector />
        <div className="grid gap-3 sm:grid-cols-2">
          {money.contracts.map((c) => (
            <div key={c.number} className="flex flex-col gap-2 rounded-lg border p-4">
              <p className="font-semibold">Договор {c.number}</p>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Начислено</span><span className="tabular-nums">{fmtMoney(c.accrual)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Удержано ГСМ</span><span className="tabular-nums">{fmtMoney(c.fuelHold)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Штрафы</span><span className="tabular-nums">{fmtMoney(c.penalty)}</span></div>
              <div className="mt-1 flex justify-between border-t pt-2 font-semibold"><span>К оплате</span><span className="tabular-nums">{fmtMoney(c.net)}</span></div>
              <div className="flex justify-between text-sm text-muted-foreground"><span>Прогноз АВР</span><span className="tabular-nums">{fmtMoney(c.forecast)}</span></div>
            </div>
          ))}
          {money.contracts.length === 0 ? <p className="text-sm text-muted-foreground">Нет данных за период</p> : null}
        </div>
      </div>
    </PortalShell>
  );
}
