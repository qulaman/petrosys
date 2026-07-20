"use server";

import { resolvePeriod } from "@/lib/journals/period";
import { loadSettlement } from "@/lib/data/settlement";
import { loadContractorAvr } from "@/lib/data/avr";
import { buildSettlementWorkbook } from "@/lib/documents/act-xlsx";
import { buildContractorAvrWorkbook } from "@/lib/documents/avr-xlsx";
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

export async function exportContractorAvrXlsx(
  contractorId: string,
  sp: { period?: string; from?: string; to?: string },
): Promise<Result> {
  try {
    const period = resolvePeriod(sp);
    const a = await loadContractorAvr(contractorId, period);
    if (!a) return { ok: false, error: "Контрагент не найден" };
    const buf = await buildContractorAvrWorkbook(a);
    return {
      ok: true,
      base64: buf.toString("base64"),
      filename: `avr-${a.contractor.name.replace(/[^\wа-яА-ЯёЁ-]+/g, "_")}-${a.period.from}.xlsx`,
    };
  } catch (e) {
    devError("exportContractorAvrXlsx", e);
    return { ok: false, error: "Не удалось сформировать АВР" };
  }
}
