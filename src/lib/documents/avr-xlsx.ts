import "server-only";
import ExcelJS from "exceljs";
import type { ContractorAvr } from "@/lib/data/avr";

/**
 * Книга Excel «АВР по ИП» в формате заказчика (20.07.2026): итог по ИП сверху,
 * далее таблица по машинам: Номер | Час | Рейс | ГСМ Б | ГСМ К | Итого.
 */
export async function buildContractorAvrWorkbook(a: ContractorAvr): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("АВР");
  ws.columns = [{ width: 12 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 10 }, { width: 16 }];
  const bold = (r: ExcelJS.Row) => (r.font = { bold: true });
  const money = "#,##0";
  const dash = (n: number) => (n > 0 ? n : "-");

  bold(ws.addRow(["West Arlan Group"]));
  bold(ws.addRow([a.contractor.name]));
  ws.addRow([`Период: ${a.period.from} — ${a.period.to}`]);
  const totalRow = ws.addRow(["НАЧИСЛЕНО ПО ИП", "", "", "", "", a.totals.accrual]);
  bold(totalRow);
  totalRow.getCell(6).numFmt = money;
  ws.addRow([]);

  const head = ws.addRow(["Номер", "Час", "Рейс", "ГСМ Б", "ГСМ К", "Итого"]);
  bold(head);
  for (const l of a.lines) {
    const r = ws.addRow([l.reg, dash(l.hours), dash(l.trips), dash(l.litersTanker), dash(l.litersCard), l.total]);
    r.getCell(6).numFmt = money;
    if (l.total < 0) r.getCell(6).font = { color: { argb: "FFCC0000" } };
  }
  ws.addRow([]);
  const sumRow = ws.addRow(["Итого", "", "", "", "", a.totals.accrual]);
  bold(sumRow);
  sumRow.getCell(6).numFmt = money;

  if (a.contractor.vat_payer) {
    const r = ws.addRow(["в т.ч. НДС (16/116) из начисления", "", "", "", "", a.totals.vat]);
    r.getCell(6).numFmt = money;
  }
  if (a.penalties.length) {
    ws.addRow([]);
    bold(ws.addRow(["Штрафы (сверх АВР)"]));
    for (const p of a.penalties) {
      const r = ws.addRow([p.reason, p.date, p.contract, "", "", -p.amount]);
      r.getCell(6).numFmt = money;
    }
    const net = ws.addRow(["К оплате со штрафами", "", "", "", "", a.totals.net]);
    bold(net);
    net.getCell(6).numFmt = money;
  }

  const warn = a.lines.filter((l) => l.noRateHours > 0 || l.noRateTrips > 0 || l.fuelPriceMissing);
  if (warn.length) {
    ws.addRow([]);
    bold(ws.addRow(["Внимание: не вошло в расчёт (нет тарифа/цены)"]));
    for (const l of warn)
      ws.addRow([
        l.reg,
        l.noRateHours > 0 ? `${l.noRateHours} ч` : "",
        l.noRateTrips > 0 ? `${l.noRateTrips} рейс.` : "",
        l.fuelPriceMissing ? "нет цены ГСМ" : "",
      ]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
