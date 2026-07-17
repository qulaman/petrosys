import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { loadContractDetail } from "@/lib/data/contracts-admin";
import { ContractDetailView } from "./contract-detail";

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [data, templatesRes] = await Promise.all([
    loadContractDetail(id),
    supabase.from("document_templates").select("id, name, contract_type").eq("doc_type", "contract").eq("is_active", true).order("name"),
  ]);
  if (!data) notFound();

  return (
    <AppShell requiredRoles={["admin", "office"]} title={`Договор ${data.contract.number}`}>
      <div className="flex flex-col gap-4">
        <Link href="/fleet/admin/contracts" className="text-sm text-primary underline">← К списку договоров</Link>
        <ContractDetailView
          data={data}
          templates={(templatesRes.data ?? []) as { id: string; name: string; contract_type: string | null }[]}
        />
      </div>
    </AppShell>
  );
}
