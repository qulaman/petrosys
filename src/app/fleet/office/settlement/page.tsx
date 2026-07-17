import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PeriodSelector } from "@/components/period-selector";
import { resolvePeriod } from "@/lib/journals/period";
import { loadContractOptions, loadSettlement } from "@/lib/data/settlement";
import { SettlementView } from "./settlement-view";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SettlementPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const contractId = first(sp.contract);

  if (!contractId) {
    const contracts = await loadContractOptions();
    return (
      <AppShell requiredRoles={["office", "admin"]} title="Закрытие периода">
        <p className="mb-3 text-sm text-muted-foreground">Выберите договор для расчёта:</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {contracts.map((c) => (
            <Link key={c.id} href={`/fleet/office/settlement?contract=${c.id}`} className="rounded-lg border p-4 hover:bg-accent">
              <p className="font-medium">{c.number}</p>
              <p className="text-sm text-muted-foreground">{c.contractor}</p>
              <p className="text-xs text-muted-foreground">
                {c.contract_type === "transportation" ? "перевозка" : "услуги техники"} · АВР {c.billing_period === "15days" ? "15 дней" : "месяц"}
              </p>
            </Link>
          ))}
          {contracts.length === 0 ? <p className="text-sm text-muted-foreground">Договоров нет</p> : null}
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
