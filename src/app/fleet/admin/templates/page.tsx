import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { TemplatesClient, type TemplateRow } from "./templates-client";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("document_templates")
    .select("id, name, doc_type, contract_type, version, is_active, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <AppShell requiredRoles={["office", "admin"]} title="Шаблоны документов">
      <TemplatesClient rows={(data ?? []) as TemplateRow[]} />
    </AppShell>
  );
}
