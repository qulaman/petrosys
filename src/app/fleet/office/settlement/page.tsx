import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PeriodSelector } from "@/components/period-selector";
import { resolvePeriod } from "@/lib/journals/period";
import { loadContractOptions, loadSettlement } from "@/lib/data/settlement";
import { loadContractorAvr, loadContractorOptions } from "@/lib/data/avr";
import { SettlementView } from "./settlement-view";
import { AvrView } from "./avr-view";
import { SettlementPicker } from "./settlement-picker";

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
        <SettlementPicker contractors={contractors} contracts={contracts} />
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
