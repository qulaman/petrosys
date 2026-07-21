import { AppShell } from "@/components/app-shell";
import { loadAvrRegistry } from "@/lib/data/avr-registry";
import { AvrRegistryClient } from "./avr-client";

/** Справочник АВР: ИП → машины → версии условий (час/рейс/ГСМ) + водители. */
export default async function AvrRegistryPage() {
  const data = await loadAvrRegistry();
  return (
    <AppShell requiredRoles={["office", "admin"]} title="Справочник АВР">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Все версии условий хранятся; в расчёт АВР берётся актуальный документ на дату работы.
          Изменение ставок — «+ условия» с новой датой, старые остаются историей.
        </p>
        <AvrRegistryClient data={data} />
      </div>
    </AppShell>
  );
}
