import { AppShell } from "@/components/app-shell";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { loadTankerData } from "@/lib/data/tanker";
import { TankerClient } from "./tanker-client";

export default async function TankerPage() {
  const [data, current] = await Promise.all([loadTankerData(), getCurrentProfile()]);
  const isAdmin = current?.profile?.roles.includes("admin") ?? false;
  return (
    <AppShell requiredRoles={["fueler", "admin"]} title="Бензовоз">
      <TankerClient data={data} isAdmin={isAdmin} />
    </AppShell>
  );
}
