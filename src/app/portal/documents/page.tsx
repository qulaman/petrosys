import { PortalShell } from "@/components/portal-shell";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { DocDownload } from "@/components/documents/doc-download";

const DOC_TYPES: Record<string, string> = {
  contract: "Договор",
  appendix1: "Приложение №1",
  appendix2: "Приложение №2",
  amendment: "Доп. соглашение",
  avr: "АВР",
  reconciliation_act: "Акт сверки",
  trip_register: "Реестр рейсов",
  fuel_statement: "Ведомость ГСМ",
  claim_overconsumption: "Претензия",
  downtime_act: "Акт простоя",
};

export default async function PortalDocuments() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("generated_documents")
    .select("id, doc_type, number, period_from, period_to, created_at")
    .order("created_at", { ascending: false });
  const rows = data ?? [];

  return (
    <PortalShell title="Мои документы">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr><th className="px-3 py-2">Тип</th><th className="px-3 py-2">Номер</th><th className="px-3 py-2">Период</th><th className="px-3 py-2">Создан</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="px-3 py-2 font-medium">{DOC_TYPES[d.doc_type] ?? d.doc_type}</td>
                <td className="px-3 py-2">{d.number}</td>
                <td className="px-3 py-2">{d.period_from ? `${d.period_from} — ${d.period_to}` : "—"}</td>
                <td className="px-3 py-2">{fmtDateTime(d.created_at)}</td>
                <td className="px-3 py-2 text-right"><DocDownload docId={d.id} /></td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Документов пока нет</td></tr> : null}
          </tbody>
        </table>
      </div>
    </PortalShell>
  );
}
