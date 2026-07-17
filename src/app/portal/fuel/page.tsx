import { PortalShell } from "@/components/portal-shell";
import { PeriodSelector } from "@/components/period-selector";
import { resolvePeriod } from "@/lib/journals/period";
import { loadFuelJournal } from "@/lib/data/journals";
import { fmtDateTime, fmtLiters } from "@/lib/format";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PortalFuel({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const period = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) });
  const rows = await loadFuelJournal({
    fromISO: period.fromISO, toISO: period.toISO, fromDate: period.fromDate, toDate: period.toDate,
  });
  const total = rows.reduce((s, r) => s + r.liters, 0);

  return (
    <PortalShell title="Выданное топливо">
      <div className="flex flex-col gap-4">
        <PeriodSelector />
        <p className="text-sm text-muted-foreground">Выдач: {rows.length} · всего: {fmtLiters(total)}</p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr><th className="px-3 py-2">Время</th><th className="px-3 py-2">Машина</th><th className="px-3 py-2">Водитель</th><th className="px-3 py-2 text-right">Литры</th><th className="px-3 py-2">Источник</th></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2">{fmtDateTime(r.at)}</td>
                  <td className="px-3 py-2 font-medium">{r.reg}</td>
                  <td className="px-3 py-2">{r.driver}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtLiters(r.liters)}</td>
                  <td className="px-3 py-2">{r.source === "card" ? "Карта" : "Бензовоз"}: {r.source_name}</td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Выдач за период нет</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </PortalShell>
  );
}
