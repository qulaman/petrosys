import { AppShell } from "@/components/app-shell";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { aqtobeToday } from "@/lib/tz";
import { loadRecentFacts } from "@/lib/data/forecast";
import { FactList, VolumeForm } from "./volume-form";

/** Ввод дневных сводок геодезиста (м³): форма + журнал последних записей. */
export default async function VolumePage() {
  const [rows, current] = await Promise.all([loadRecentFacts(), getCurrentProfile()]);
  const roles = current?.profile?.roles ?? [];
  const canDelete = ["itr", "office", "admin"].some((r) => roles.includes(r));

  return (
    <AppShell requiredRoles={["itr", "office", "admin"]} title="Объём — сводки">
      <div className="flex flex-col gap-4">
        <VolumeForm today={aqtobeToday()} />
        <h3 className="text-sm font-medium">Последние сводки</h3>
        <FactList rows={rows} canDelete={canDelete} />
      </div>
    </AppShell>
  );
}
