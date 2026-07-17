import { AppShell } from "@/components/app-shell";
import { loadFuelIssueData } from "@/lib/data/fuel-issue";
import { IssueForm } from "./issue-form";

export default async function FuelIssuePage() {
  const data = await loadFuelIssueData();
  return (
    <AppShell requiredRoles={["fueler", "admin"]} title="Выдача топлива">
      <IssueForm data={data} />
    </AppShell>
  );
}
