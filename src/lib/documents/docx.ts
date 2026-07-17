import "server-only";
import PizZip from "pizzip";

/**
 * Минимальный генератор .docx без внешних шаблонов: документ собирается из
 * абзацев и таблиц в OOXML и пакуется pizzip. Когда заказчик передаст фирменные
 * docx-шаблоны (выверенные юристом), этот слой заменяется docxtemplater'ом —
 * вызывающий код не меняется (те же данные, тот же Buffer на выходе).
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface TextOpts {
  bold?: boolean;
  size?: number; // пунктов
  align?: "left" | "center" | "right" | "both";
}

/** Абзац. */
export function p(text: string, opts: TextOpts = {}): string {
  const { bold, size = 11, align } = opts;
  const rPr = `<w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/></w:rPr>`;
  const pPr = align ? `<w:pPr><w:jc w:val="${align}"/></w:pPr>` : "";
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

/** Пустая строка. */
export const br = "<w:p/>";

/** Таблица во всю ширину с тонкими рамками. Первая строка — шапка (жирная). */
export function table(rows: string[][], opts: { headerRow?: boolean } = {}): string {
  const { headerRow = true } = opts;
  const cols = rows[0]?.length ?? 1;
  const w = Math.floor(9800 / cols);
  const borders =
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="666666"/><w:left w:val="single" w:sz="4" w:color="666666"/><w:bottom w:val="single" w:sz="4" w:color="666666"/><w:right w:val="single" w:sz="4" w:color="666666"/><w:insideH w:val="single" w:sz="4" w:color="666666"/><w:insideV w:val="single" w:sz="4" w:color="666666"/></w:tblBorders>';
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
  const body = rows
    .map((cells, ri) => {
      const tds = cells
        .map(
          (c) =>
            `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${p(c, { bold: headerRow && ri === 0, size: 10 })}</w:tc>`,
        )
        .join("");
      return `<w:tr>${tds}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="9800" w:type="dxa"/>${borders}</w:tblPr>${grid}${body}</w:tbl>`;
}

/** Собирает валидный .docx из XML-фрагментов (p/table/br). */
export function buildDocx(children: string[]): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${children.join("")}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1418"/></w:sectPr>
</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const zip = new PizZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rels);
  zip.file("word/document.xml", documentXml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Шапка «Исполнитель/Заказчик» из реквизитов контрагента. */
export interface PartyRequisites {
  name: string;
  bin?: string | null;
  legal_address?: string | null;
  bank_name?: string | null;
  iik?: string | null;
  bik?: string | null;
  head_name?: string | null;
}

export function requisitesBlock(title: string, r: PartyRequisites): string[] {
  const lines = [
    p(title, { bold: true }),
    p(r.name),
    ...(r.bin ? [p(`БИН/ИИН: ${r.bin}`)] : []),
    ...(r.legal_address ? [p(`Адрес: ${r.legal_address}`)] : []),
    ...(r.bank_name ? [p(`Банк: ${r.bank_name}${r.iik ? `, ИИК ${r.iik}` : ""}${r.bik ? `, БИК ${r.bik}` : ""}`)] : []),
    ...(r.head_name ? [p(`Руководитель: ${r.head_name}`)] : []),
  ];
  return lines;
}
