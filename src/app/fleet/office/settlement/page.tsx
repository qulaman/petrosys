import Link from "next/link";
import { FileSignature, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PeriodSelector } from "@/components/period-selector";
import { resolvePeriod } from "@/lib/journals/period";
import { loadContractOptions, loadSettlement } from "@/lib/data/settlement";
import { loadContractorAvr, loadContractorOptions } from "@/lib/data/avr";
import { SettlementView } from "./settlement-view";
import { AvrView } from "./avr-view";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SettlementPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const contractId = first(sp.contract);
  const contractorId = first(sp.contractor);

  // Режим «АВР по ИП»: свод по контрагенту, итог сверху (формула заказчика).
  if (contractorId) {
    const period = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) });
    const avr = await loadContractorAvr(contractorId, period);
    return (
      <AppShell requiredRoles={["office", "admin"]} title="АВР по ИП">
        <div className="flex flex-col gap-4">
          <Link href="/fleet/office/settlement" className="text-sm text-primary underline">← К списку</Link>
          <PeriodSelector extraParams={{ contractor: contractorId }} />
          {avr ? <AvrView avr={avr} /> : <p className="text-sm text-muted-foreground">Контрагент не найден.</p>}
        </div>
      </AppShell>
    );
  }

  if (!contractId) {
    const [contractors, contracts] = await Promise.all([loadContractorOptions(), loadContractOptions()]);
    return (
      <AppShell requiredRoles={["office", "admin"]} title="Закрытие периода">
        <div className="flex flex-col gap-6">
          <section>
            <p className="mb-3 text-sm text-muted-foreground">АВР по ИП — свод по машинам контрагента:</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {contractors.map((c) => (
                <Link key={c.id} href={`/fleet/office/settlement?contractor=${c.id}`} className="rounded-lg border p-4 hover:bg-accent">
                  <p className="flex items-center gap-2 font-medium">
                    <Users className="size-4 shrink-0 text-primary" />
                    {c.name}
                  </p>
                  <p className="text-xs text-muted-foreground">машин: {c.vehicles}</p>
                </Link>
              ))}
              {contractors.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="Контрагентов с машинами нет"
                  description="Привяжите машины к контрагентам в «Справочники → Техника»."
                  className="sm:col-span-2 lg:col-span-3"
                />
              ) : null}
            </div>
          </section>
          <section>
            <p className="mb-3 text-sm text-muted-foreground">Расчёт по отдельному договору:</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {contracts.map((c) => (
                <Link key={c.id} href={`/fleet/office/settlement?contract=${c.id}`} className="rounded-lg border p-4 hover:bg-accent">
                  <p className="flex items-center gap-2 font-medium">
                    <FileSignature className="size-4 shrink-0 text-primary" />
                    {c.number}
                  </p>
                  <p className="text-sm text-muted-foreground">{c.contractor}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.contract_type === "transportation" ? "перевозка" : "услуги техники"} · АВР {c.billing_period === "15days" ? "15 дней" : "месяц"}
                  </p>
                </Link>
              ))}
              {contracts.length === 0 ? (
                <EmptyState
                  icon={FileSignature}
                  title="Договоров нет"
                  description="Добавьте договор в «Справочники → Договоры и прайсы» — здесь появится расчёт по нему."
                  className="sm:col-span-2 lg:col-span-3"
                />
              ) : null}
            </div>
          </section>
        </div>
      </AppShell>
    );
  }

  const period = resolvePeriod({ period: first(sp.period), from: first(sp.from), to: first(sp.to) });
  const settlement = await loadSettlement(contractId, period);

  return (
    <AppShell requiredRoles={["office", "admin"]} title="Закрытие периода">
      <div className="flex flex-col gap-4">
        <Link href="/fleet/office/settlement" className="text-sm text-primary underline">← К списку договоров</Link>
        <PeriodSelector extraParams={{ contract: contractId }} />
        {settlement ? (
          <SettlementView settlement={settlement} />
        ) : (
          <p className="text-sm text-muted-foreground">Договор не найден.</p>
        )}
      </div>
    </AppShell>
  );
}
