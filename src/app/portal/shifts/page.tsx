import { PortalShell } from "@/components/portal-shell";
import { PeriodSelector } from "@/components/period-selector";
import { resolvePeriod } from "@/lib/journals/period";
import { loadShiftJournal } from "@/lib/data/journals";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PortalShifts({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const period = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) });
  const rows = await loadShiftJournal({
    fromISO: period.fromISO, toISO: period.toISO, fromDate: period.fromDate, toDate: period.toDate,
  });

  return (
    <PortalShell title="Мои смены">
      <div className="flex flex-col gap-4">
        <PeriodSelector />
        <p className="text-sm text-muted-foreground">Смен: {rows.length} · часов: {rows.reduce((s, r) => s + r.hours, 0)}</p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr><th className="px-3 py-2">Дата</th><th className="px-3 py-2">Смена</th><th className="px-3 py-2">Машина</th><th className="px-3 py-2">Водитель</th><th className="px-3 py-2 text-right">Часы</th></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2">{r.date}</td>
                  <td className="px-3 py-2">{r.shift === "day" ? "День" : "Ночь"}</td>
                  <td className="px-3 py-2 font-medium">{r.reg}</td>
                  <td className="px-3 py-2">{r.driver}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.hours}</td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Нет смен за период</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </PortalShell>
  );
}
