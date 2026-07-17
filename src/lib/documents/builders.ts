import "server-only";
import ExcelJS from "exceljs";
import { br, buildDocx, p, requisitesBlock, table, type PartyRequisites } from "@/lib/documents/docx";
import { vehicleTypeLabel } from "@/lib/domain";

const UNIT_RU: Record<string, string> = { trip: "рейс", hour: "час" };
const money = (v: number) => `${new Intl.NumberFormat("ru-RU").format(v)} ₸`;

export interface RateLine {
  vehicle_type: string;
  unit: string;
  price: number;
  vehicle_reg?: string | null;
  valid_from: string;
}
export interface ContractDocData {
  number: string;
  contract_type: string;
  billing_period: string;
  valid_from: string;
  valid_to: string | null;
  contractor: PartyRequisites & { vat_payer: boolean };
  rates: RateLine[];
  fuelPrices: { price_per_liter: number; valid_from: string }[];
}

/** Договор (generic-заготовка до получения фирменного шаблона юриста). */
export function contractDocx(d: ContractDocData): Buffer {
  const typeRu = d.contract_type === "transportation" ? "перевозки грунта" : "оказания услуг строительной техники";
  return buildDocx([
    p(`ДОГОВОР ${typeRu} № ${d.number}`, { bold: true, size: 14, align: "center" }),
    p(`от ${d.valid_from}`, { align: "center" }),
    br,
    ...requisitesBlock("Исполнитель:", d.contractor),
    p(`НДС: ${d.contractor.vat_payer ? "плательщик (цены включают НДС)" : "не является плательщиком"}`),
    br,
    p("1. Предмет договора", { bold: true }),
    p(d.contract_type === "transportation"
      ? "Исполнитель обязуется выполнять перевозку грунта собственным автотранспортом, Заказчик — принимать и оплачивать выполненные рейсы по ставкам Приложения №1."
      : "Исполнитель предоставляет строительную технику с экипажем, Заказчик оплачивает отработанные моточасы по ставкам Приложения №1."),
    p(`Расчётный период: ${d.billing_period === "15days" ? "каждые 15 дней" : "календарный месяц"}. Срок действия: с ${d.valid_from}${d.valid_to ? ` по ${d.valid_to}` : ", бессрочно"}.`),
    br,
    p("2. Топливо", { bold: true }),
    p("ГСМ выдаётся Заказчиком с учётом каждой выдачи под подпись водителя; стоимость удерживается из вознаграждения по цене Приложения №1."),
    br,
    p("3. Учёт", { bold: true }),
    p("Учёт рейсов, моточасов и ГСМ ведётся в электронной системе Заказчика; записи с электронной подписью водителя признаются сторонами первичными документами."),
    br,
    p("Неотъемлемые части: Приложение №1 (ставки и цена ГСМ), Приложение №2 (списки техники и операторов)."),
    br, br,
    p("Заказчик: ______________________        Исполнитель: ______________________"),
  ]);
}

/** Приложение №1 — спецификация: ставки и цена ГСМ. */
export function appendix1Docx(d: ContractDocData): Buffer {
  const rateRows = [
    ["Вид техники", "Ед.", "Ставка", "Действует с"],
    ...d.rates.map((r) => [
      `${vehicleTypeLabel(r.vehicle_type)}${r.vehicle_reg ? ` (${r.vehicle_reg})` : ""}`,
      UNIT_RU[r.unit] ?? r.unit,
      money(r.price),
      r.valid_from,
    ]),
  ];
  const fuelRows = [
    ["Цена ГСМ, ₸/л", "Действует с"],
    ...d.fuelPrices.map((f) => [money(f.price_per_liter), f.valid_from]),
  ];
  return buildDocx([
    p(`Приложение №1 к договору № ${d.number}`, { bold: true, size: 13, align: "center" }),
    p("Спецификация: ставки и цена ГСМ", { align: "center" }),
    br,
    p("1. Ставки", { bold: true }),
    table(rateRows),
    br,
    p("2. Цена ГСМ для удержания", { bold: true }),
    d.fuelPrices.length ? table(fuelRows) : p("Удержание ГСМ не предусмотрено."),
    br,
    p("Заказчик: ______________________        Исполнитель: ______________________"),
  ]);
}

/** Приложение №2 — списки техники и операторов (редакция N). */
export function appendix2Docx(args: {
  contractNumber: string;
  revision: number;
  date: string;
  vehicles: { reg_number: string; brand: string; vehicle_type: string; approved_from: string | null }[];
  drivers: { full_name: string; iin: string | null; approved_from: string | null }[];
}): Buffer {
  const vRows = [
    ["№", "Гос. номер", "Марка", "Вид"],
    ...args.vehicles.map((v, i) => [String(i + 1), v.reg_number, v.brand, vehicleTypeLabel(v.vehicle_type)]),
  ];
  const dRows = [
    ["№", "ФИО", "ИИН"],
    ...args.drivers.map((d, i) => [String(i + 1), d.full_name, d.iin ?? "—"]),
  ];
  return buildDocx([
    p(`Приложение №2 к договору № ${args.contractNumber}`, { bold: true, size: 13, align: "center" }),
    p(`Списки допущенной техники и операторов · редакция ${args.revision} от ${args.date}`, { align: "center" }),
    br,
    p("1. Техника", { bold: true }),
    args.vehicles.length ? table(vRows) : p("—"),
    br,
    p("2. Операторы (водители/машинисты)", { bold: true }),
    args.drivers.length ? table(dRows) : p("—"),
    br,
    p("Настоящая редакция заменяет все предыдущие редакции Приложения №2."),
    br,
    p("Заказчик: ______________________        Исполнитель: ______________________"),
  ]);
}

/** Доп. соглашение об изменении ставок/цены ГСМ с даты. */
export function amendmentDocx(args: {
  contractNumber: string;
  contractorName: string;
  validFrom: string;
  rates: RateLine[];
  fuelPrices: { price_per_liter: number }[];
}): Buffer {
  const parts: string[] = [
    p(`Дополнительное соглашение к договору № ${args.contractNumber}`, { bold: true, size: 13, align: "center" }),
    p(`с ${args.contractorName}`, { align: "center" }),
    br,
    p(`Стороны согласовали: с ${args.validFrom} действуют следующие условия.`),
    br,
  ];
  if (args.rates.length) {
    parts.push(
      p("Новые ставки:", { bold: true }),
      table([
        ["Вид техники", "Ед.", "Ставка"],
        ...args.rates.map((r) => [
          `${vehicleTypeLabel(r.vehicle_type)}${r.vehicle_reg ? ` (${r.vehicle_reg})` : ""}`,
          UNIT_RU[r.unit] ?? r.unit,
          money(r.price),
        ]),
      ]),
      br,
    );
  }
  for (const f of args.fuelPrices) {
    parts.push(p(`Новая цена ГСМ: ${money(f.price_per_liter)} за литр.`, { bold: true }), br);
  }
  parts.push(
    p("Остальные условия договора остаются без изменений."),
    br, br,
    p("Заказчик: ______________________        Исполнитель: ______________________"),
  );
  return buildDocx(parts);
}

/** Претензия о превышении норматива расхода ГСМ. */
export function claimDocx(args: {
  contractNumber: string;
  contractorName: string;
  reg: string;
  month: string;
  actual: number;
  norm: number;
  hours: number;
  liters: number;
  overLiters: number;
  pricePerLiter: number | null;
}): Buffer {
  const amount = args.pricePerLiter ? Math.round(args.overLiters * args.pricePerLiter * 100) / 100 : null;
  return buildDocx([
    p("ПРЕТЕНЗИЯ", { bold: true, size: 14, align: "center" }),
    p(`о превышении норматива расхода ГСМ по договору № ${args.contractNumber}`, { align: "center" }),
    br,
    p(`Кому: ${args.contractorName}`),
    br,
    p(`За период ${args.month} по единице техники ${args.reg} зафиксирован расход топлива сверх норматива, установленного Приложением №2 договора:`),
    table([
      ["Показатель", "Значение"],
      ["Отработано моточасов", String(args.hours)],
      ["Выдано топлива, л", String(args.liters)],
      ["Фактический расход, л/моточас", String(args.actual)],
      ["Норматив, л/моточас", String(args.norm)],
      ["Перерасход, л", String(Math.round(args.overLiters * 10) / 10)],
      ...(amount != null ? [["Сумма к возмещению", money(amount)]] : []),
    ]),
    br,
    p("Расход сверх норматива без письменного согласования не допускается условиями договора. Требуем возместить стоимость перерасхода; сумма подлежит удержанию из ближайшего акта выполненных работ."),
    br,
    p("Приложение: детализация выдач топлива и табеля за период (по данным системы учёта)."),
    br, br,
    p("Заказчик: ______________________"),
  ]);
}

/** Акт простоя. */
export function downtimeActDocx(args: {
  contractNumber: string | null;
  reg: string;
  date: string;
  faultSide: string;
  reason: string;
  hours: number | null;
  notifiedAt: string | null;
  compensable: boolean;
}): Buffer {
  return buildDocx([
    p("АКТ ПРОСТОЯ", { bold: true, size: 14, align: "center" }),
    br,
    table([
      ["Показатель", "Значение"],
      ["Дата простоя", args.date],
      ["Техника", args.reg],
      ...(args.contractNumber ? [["Договор", args.contractNumber]] : []),
      ["Сторона вины", args.faultSide === "client" ? "Заказчик" : "Исполнитель"],
      ["Причина", args.reason],
      ...(args.hours != null ? [["Часы простоя", String(args.hours)]] : []),
      ...(args.notifiedAt ? [["Уведомление направлено", args.notifiedAt]] : []),
    ]),
    br,
    p(args.faultSide === "client"
      ? (args.compensable
          ? "Простой по вине Заказчика без уведомления до 18:00 предыдущего дня — подлежит компенсации в размере 20% дневной ставки."
          : "Простой по вине Заказчика с своевременным уведомлением — компенсация не начисляется.")
      : "Простой по вине Исполнителя — оплате не подлежит."),
    br, br,
    p("Заказчик: ______________________        Исполнитель: ______________________"),
  ]);
}

// =========================== Excel-отчёты пакета закрытия ===========================

const XLSX_HEADER_FONT = { bold: true } as const;

export async function buildAvrXlsx(args: {
  number: string;
  contractNumber: string;
  contractor: PartyRequisites & { vat_payer: boolean };
  periodFrom: string;
  periodTo: string;
  lines: { reg: string; unit: string; qty: number; rate: number; amount: number }[];
  total: number;
  vat: number;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("АВР");
  ws.columns = [{ width: 24 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 16 }];
  const bold = (r: ExcelJS.Row) => (r.font = XLSX_HEADER_FONT);
  bold(ws.addRow([`Акт выполненных работ ${args.number}`]));
  ws.addRow([`Договор ${args.contractNumber} · ${args.contractor.name}`]);
  if (args.contractor.bin) ws.addRow([`БИН/ИИН: ${args.contractor.bin}`]);
  if (args.contractor.bank_name) ws.addRow([`Банк: ${args.contractor.bank_name} ИИК ${args.contractor.iik ?? ""} БИК ${args.contractor.bik ?? ""}`]);
  ws.addRow([`Период: ${args.periodFrom} — ${args.periodTo}`]);
  ws.addRow([]);
  bold(ws.addRow(["Машина", "Ед.", "Кол-во", "Ставка", "Сумма, ₸"]));
  for (const l of args.lines) ws.addRow([l.reg, UNIT_RU[l.unit] ?? l.unit, l.qty, l.rate, l.amount]);
  bold(ws.addRow(["ИТОГО", "", "", "", args.total]));
  if (args.contractor.vat_payer) ws.addRow(["в т.ч. НДС (16/116)", "", "", "", args.vat]);
  ws.addRow([]);
  ws.addRow(["Заказчик: ______________", "", "", "Исполнитель: ______________"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildTripRegisterXlsx(args: {
  number: string;
  contractNumber: string;
  periodFrom: string;
  periodTo: string;
  rows: { at: string; reg: string; driver: string; route: string }[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Реестр рейсов");
  ws.columns = [{ width: 6 }, { width: 20 }, { width: 14 }, { width: 22 }, { width: 26 }];
  ws.addRow([`Реестр рейсов ${args.number} · договор ${args.contractNumber} · ${args.periodFrom}—${args.periodTo}`]).font = XLSX_HEADER_FONT;
  ws.addRow([]);
  ws.addRow(["№", "Дата и время", "Машина", "Водитель", "Маршрут"]).font = XLSX_HEADER_FONT;
  args.rows.forEach((r, i) => ws.addRow([i + 1, r.at, r.reg, r.driver, r.route]));
  ws.addRow([]);
  ws.addRow([`Всего рейсов: ${args.rows.length}`]).font = XLSX_HEADER_FONT;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildFuelStatementXlsx(args: {
  number: string;
  contractNumber: string;
  periodFrom: string;
  periodTo: string;
  rows: { at: string; reg: string; driver: string; liters: number; source: string }[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Ведомость ГСМ");
  ws.columns = [{ width: 6 }, { width: 20 }, { width: 14 }, { width: 22 }, { width: 10 }, { width: 18 }];
  ws.addRow([`Ведомость выдачи ГСМ ${args.number} · договор ${args.contractNumber} · ${args.periodFrom}—${args.periodTo}`]).font = XLSX_HEADER_FONT;
  ws.addRow([]);
  ws.addRow(["№", "Дата и время", "Машина", "Водитель", "Литры", "Источник"]).font = XLSX_HEADER_FONT;
  args.rows.forEach((r, i) => ws.addRow([i + 1, r.at, r.reg, r.driver, r.liters, r.source]));
  ws.addRow([]);
  ws.addRow([`Итого литров: ${args.rows.reduce((s, r) => s + r.liters, 0)}`]).font = XLSX_HEADER_FONT;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
