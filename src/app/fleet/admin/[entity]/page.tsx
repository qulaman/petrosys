import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { ENTITIES } from "@/lib/admin/registry";
import { CrudTable } from "@/components/admin/crud-table";

export default async function EntityPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity } = await params;
  const cfg = ENTITIES[entity];
  if (!cfg) notFound();

  // Динамические имена таблиц — нетипизированный клиент для конфиг-движка.
  const supabase = (await createClient()) as unknown as SupabaseClient;

  // Строки и FK-опции — одной волной параллельных запросов.
  const optionSources: { key: string; from: "contractors" | "vehicles" | "contracts" }[] = [];
  for (const f of cfg.fields) {
    if (f.optionsFrom) optionSources.push({ key: f.key, from: f.optionsFrom });
  }
  const [rowsRes, ...optionResults] = await Promise.all([
    supabase.from(cfg.slug).select("*").order("created_at", { ascending: false }),
    ...optionSources.map(({ from }) =>
      from === "contractors"
        ? supabase.from("contractors").select("id, name").eq("is_active", true).order("name")
        : from === "vehicles"
          ? supabase.from("vehicles").select("id, reg_number").eq("is_active", true).order("reg_number")
          : supabase.from("contracts").select("id, number").order("number"),
    ),
  ]);
  const rows = rowsRes.data;

  const optionsByField: Record<string, { value: string; label: string }[]> = {};
  optionSources.forEach(({ key, from }, i) => {
    const data = (optionResults[i]?.data ?? []) as Record<string, string>[];
    optionsByField[key] = data.map((r) => ({
      value: r.id,
      label: from === "vehicles" ? r.reg_number : from === "contracts" ? r.number : r.name,
    }));
  });

  return (
    <AppShell requiredRoles={["admin", "office"]} title={`Справочник · ${cfg.title}`}>
      <CrudTable
        slug={entity}
        rows={(rows ?? []) as (Record<string, unknown> & { id: string })[]}
        optionsByField={optionsByField}
      />
    </AppShell>
  );
}
