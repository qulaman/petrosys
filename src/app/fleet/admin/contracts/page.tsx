import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { loadContractsList } from "@/lib/data/contracts-admin";
import { ContractsList } from "./contracts-list";

export default async function ContractsPage() {
  const supabase = await createClient();
  const [contracts, contractorsRes, templatesRes] = await Promise.all([
    loadContractsList(),
    supabase.from("contractors").select("id, name").eq("is_active", true).order("name"),
    supabase.from("document_templates").select("id, name, contract_type").eq("doc_type", "contract").eq("is_active", true).order("name"),
  ]);

  return (
    <AppShell requiredRoles={["admin", "office"]} title="Договоры">
      <ContractsList
        contracts={contracts}
        contractors={(contractorsRes.data ?? []) as { id: string; name: string }[]}
        templates={(templatesRes.data ?? []) as { id: string; name: string; contract_type: string | null }[]}
      />
    </AppShell>
  );
}
