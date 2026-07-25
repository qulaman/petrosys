import "server-only";
import ExcelJS from "exceljs";
import type { DirectorySheet } from "@/lib/data/directories";

/**
 * Книга Excel «Справочники»: лист на справочник, первый лист — оглавление
 * с количеством строк. Форматирование одинаковое для всех листов, вся
 * доменная логика (подписи, подстановка id → название) остаётся в загрузчике.
 */
export async function buildDirectoriesWorkbook(
  sheets: DirectorySheet[],
  exportedAt: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const toc = wb.addWorksheet("Оглавление");
  toc.columns = [{ width: 30 }, { width: 14 }];
  const title = toc.addRow(["Справочники Arlan Ops"]);
  title.font = { bold: true, size: 14 };
  toc.addRow([`Выгружено: ${exportedAt}`]);
  toc.addRow([]);
  const tocHead = toc.addRow(["Справочник", "Записей"]);
  tocHead.font = { bold: true };
  for (const s of sheets) toc.addRow([s.name, s.rows.length]);

  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.columns = s.widths.map((width) => ({ width }));
    const head = ws.addRow(s.headers);
    head.font = { bold: true };
    head.alignment = { vertical: "middle", wrapText: true };
    for (const r of s.rows) ws.addRow(r.map((v) => v ?? "—"));
    // Шапка не уезжает при прокрутке, включён автофильтр по всем колонкам.
    ws.views = [{ state: "frozen", ySplit: 1 }];
    if (s.rows.length) {
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: s.headers.length },
      };
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
