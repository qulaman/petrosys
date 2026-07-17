"use server";

import { resolvePeriod } from "@/lib/journals/period";
import { loadSettlement } from "@/lib/data/settlement";
import { buildSettlementWorkbook } from "@/lib/documents/act-xlsx";
import { devError } from "@/lib/dev-log";

type Result =
  | { ok: true; base64: string; filename: string }
  | { ok: false; error: string };

export async function exportSettlementXlsx(
  contractId: string,
  sp: { period?: string; from?: string; to?: string },
): Promise<Result> {
  try {
    const period = resolvePeriod(sp);
    const s = await loadSettlement(contractId, period);
    if (!s) return { ok: false, error: "Договор не найден" };
    const buf = await buildSettlementWorkbook(s);
    return {
      ok: true,
      base64: buf.toString("base64"),
      filename: `akt-${s.contract.number.replace(/[^\w-]/g, "_")}.xlsx`,
    };
  } catch (e) {
    devError("exportSettlementXlsx", e);
    return { ok: false, error: "Не удалось сформировать акт" };
  }
}
