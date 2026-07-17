import "server-only";
import ExcelJS from "exceljs";
import type { Settlement } from "@/lib/data/settlement";

/** Строит книгу Excel «Акт сверки» из расчёта закрытия периода. */
export async function buildSettlementWorkbook(s: Settlement): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Акт сверки");
  ws.columns = [{ width: 24 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 16 }];
  const bold = (r: ExcelJS.Row) => (r.font = { bold: true });

  bold(ws.addRow(["Акт сверки по договору", s.contract.number]));
  ws.addRow(["Контрагент", s.contractor.name]);
  ws.addRow(["НДС", s.contractor.vat_payer ? "плательщик" : "не плательщик"]);
  ws.addRow(["Период", `${s.period.from} — ${s.period.to}`]);
  ws.addRow([]);

  bold(ws.addRow(["Начислено"]));
  bold(ws.addRow(["Машина", "Ед.", "Кол-во", "Ставка", "Сумма, ₸"]));
  for (const l of s.accrual) ws.addRow([l.reg, l.unit === "trip" ? "рейс" : "час", l.qty, l.rate, l.amount]);
  bold(ws.addRow(["Итого начислено", "", "", "", s.totals.accrual]));
  if (s.contractor.vat_payer) ws.addRow(["в т.ч. НДС (16/116)", "", "", "", s.totals.vat]);

  if (s.noRate.length) {
    ws.addRow([]);
    bold(ws.addRow(["Нет тарифа (в итог не включено)"]));
    for (const l of s.noRate) ws.addRow([l.reg, l.unit === "trip" ? "рейс" : "час", l.qty]);
  }

  ws.addRow([]);
  bold(ws.addRow(["Удержано за ГСМ"]));
  bold(ws.addRow(["Машина", "Литры", "", "", "Сумма, ₸"]));
  for (const l of s.fuel) ws.addRow([l.reg, l.liters, l.priceMissing ? "нет цены" : "", "", l.amount]);
  bold(ws.addRow(["Итого ГСМ", "", "", "", s.totals.fuelHold]));

  if (s.penalties.length) {
    ws.addRow([]);
    bold(ws.addRow(["Штрафы"]));
    for (const p of s.penalties) ws.addRow([p.reason, p.date, "", "", p.amount]);
    bold(ws.addRow(["Итого штрафы", "", "", "", s.totals.penalty]));
  }

  ws.addRow([]);
  bold(ws.addRow(["К ОПЛАТЕ", "", "", "", s.totals.net]));

  return Buffer.from(await wb.xlsx.writeBuffer());
}
