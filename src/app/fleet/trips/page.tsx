import { AppShell } from "@/components/app-shell";
import { loadTripsData } from "@/lib/data/trips";
import { TripsClient } from "./trips-client";

export default async function TripsPage() {
  const data = await loadTripsData();
  return (
    <AppShell requiredRoles={["checker", "admin"]} title="Фиксация рейсов">
      <TripsClient data={data} />
    </AppShell>
  );
}
