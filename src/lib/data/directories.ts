import "server-only";
import { createClient } from "@/lib/supabase/server";
import { vehicleTypeLabel } from "@/lib/domain";
import { ROLE_LABELS, isRole } from "@/lib/auth/roles";

/** Лист выгрузки: готовые заголовки и строки — рендер не знает про домен. */
export interface DirectorySheet {
  name: string;
  headers: string[];
  widths: number[];
  rows: (string | number | null)[][];
}

const ACCOUNTING: Record<string, string> = {
  hours: "Моточасы",
  trips: "Рейсы",
  both: "Часы + рейсы",
};
const SOURCE: Record<string, string> = {
  import: "импорт",
  manual: "вручную",
  field: "с поля",
};
const COUNTERPARTY: Record<string, string> = {
  subcontractor: "Субподрядчик",
  client: "Заказчик",
};
const CONTRACT_TYPE: Record<string, string> = {
  transportation: "Перевозка",
  equipment: "Услуги техники",
};
const BILLING: Record<string, string> = { monthly: "Месяц", "15days": "15 дней" };
const UNIT: Record<string, string> = { trip: "рейс", hour: "час" };
const FAULT: Record<string, string> = { contractor: "Подрядчик", client: "Заказчик" };

const label = (dict: Record<string, string>, v: string | null) =>
  v == null ? null : (dict[v] ?? v);
/** Даты в справочниках — календарные (YYYY-MM-DD), без часового пояса. */
const dmy = (d: string | null) => (d ? d.split("-").reverse().join(".") : null);
const yesNo = (v: boolean | null) => (v ? "да" : "нет");

/**
 * Все справочники системы одним снимком: договорной контур, парк, люди,
 * штрафы/простои. Запросы идут через RLS от имени пользователя — подрядчик
 * ничего лишнего не выгрузит. Объёмы справочников малы, пагинация не нужна.
 */
export async function loadDirectorySheets(): Promise<DirectorySheet[]> {
  const supabase = await createClient();

  const [
    contractors,
    contracts,
    vehicles,
    drivers,
    priceList,
    fuelPrices,
    fuelCards,
    tankers,
    routes,
    workTypes,
    downtime,
    penalties,
    profiles,
  ] = await Promise.all([
    supabase.from("contractors").select("*").order("name"),
    supabase.from("contracts").select("*").order("number"),
    supabase.from("vehicles").select("*").order("reg_number"),
    supabase.from("drivers").select("*").order("full_name"),
    supabase.from("price_list").select("*").order("valid_from", { ascending: false }),
    supabase.from("contract_fuel_prices").select("*").order("valid_from", { ascending: false }),
    supabase.from("fuel_cards").select("*").order("card_number"),
    supabase.from("tankers").select("*").order("name"),
    supabase.from("routes").select("*").order("name"),
    supabase.from("work_types").select("*").order("name"),
    supabase.from("downtime_records").select("*").order("downtime_date", { ascending: false }),
    supabase.from("penalties").select("*").order("penalty_date", { ascending: false }),
    supabase.from("profiles").select("id, full_name, roles, contractor_id").order("full_name"),
  ]);

  // Подстановки: id → человекочитаемое значение (в файле не должно быть UUID).
  const contractorName = new Map((contractors.data ?? []).map((c) => [c.id, c.name]));
  const contractNumber = new Map((contracts.data ?? []).map((c) => [c.id, c.number]));
  const contractOwner = new Map((contracts.data ?? []).map((c) => [c.id, c.contractor_id]));
  const vehicleReg = new Map((vehicles.data ?? []).map((v) => [v.id, v.reg_number]));
  const driverName = new Map((drivers.data ?? []).map((d) => [d.id, d.full_name]));

  const ownerName = (contractId: string | null) => {
    const owner = contractId ? contractOwner.get(contractId) : null;
    return owner ? (contractorName.get(owner) ?? null) : null;
  };

  return [
    {
      name: "Техника",
      headers: [
        "Гос. номер", "Марка", "Вид", "Тип учёта", "Подрядчик", "Договор",
        "Норма л/ч", "Водитель день", "Водитель ночь", "Допуск с", "Допуск по",
        "QR-код", "Источник", "Активна",
      ],
      widths: [14, 18, 14, 14, 28, 16, 10, 24, 24, 12, 12, 16, 12, 10],
      rows: (vehicles.data ?? []).map((v) => [
        v.reg_number,
        v.brand,
        vehicleTypeLabel(v.vehicle_type),
        label(ACCOUNTING, v.accounting_type),
        v.contractor_id ? (contractorName.get(v.contractor_id) ?? null) : null,
        v.contract_id ? (contractNumber.get(v.contract_id) ?? null) : null,
        v.fuel_norm_per_hour,
        v.day_driver_id ? (driverName.get(v.day_driver_id) ?? null) : null,
        v.night_driver_id ? (driverName.get(v.night_driver_id) ?? null) : null,
        dmy(v.approved_from),
        dmy(v.approved_to),
        v.qr_code,
        label(SOURCE, v.source),
        yesNo(v.is_active),
      ]),
    },
    {
      name: "Водители",
      headers: ["ФИО", "ИИН", "Телефон", "Подрядчик", "Договор", "Допуск с", "Допуск по", "Активен"],
      widths: [30, 16, 16, 28, 16, 12, 12, 10],
      rows: (drivers.data ?? []).map((d) => [
        d.full_name,
        d.iin,
        d.phone,
        d.contractor_id ? (contractorName.get(d.contractor_id) ?? null) : null,
        d.contract_id ? (contractNumber.get(d.contract_id) ?? null) : null,
        dmy(d.approved_from),
        dmy(d.approved_to),
        yesNo(d.is_active),
      ]),
    },
    {
      name: "Контрагенты",
      headers: [
        "Наименование", "Тип", "БИН/ИИН", "Юридический адрес", "Руководитель",
        "Телефон", "Банк", "ИИК", "БИК", "Плательщик НДС", "Активен",
      ],
      widths: [30, 16, 16, 36, 26, 16, 24, 24, 12, 14, 10],
      rows: (contractors.data ?? []).map((c) => [
        c.name,
        label(COUNTERPARTY, c.counterparty_type),
        c.bin,
        c.legal_address,
        c.head_name,
        c.contact_phone,
        c.bank_name,
        c.iik,
        c.bik,
        yesNo(c.vat_payer),
        yesNo(c.is_active),
      ]),
    },
    {
      name: "Договоры",
      headers: ["Номер", "Контрагент", "Тип", "Период расчётов", "Действует с", "Действует по", "Активен"],
      widths: [18, 30, 18, 16, 14, 14, 10],
      rows: (contracts.data ?? []).map((c) => [
        c.number,
        contractorName.get(c.contractor_id) ?? null,
        label(CONTRACT_TYPE, c.contract_type),
        label(BILLING, c.billing_period),
        dmy(c.valid_from),
        dmy(c.valid_to),
        yesNo(c.is_active),
      ]),
    },
    {
      name: "Прайсы",
      headers: ["Договор", "Контрагент", "Вид техники", "Машина", "Единица", "Цена, ₸", "Действует с", "Документ", "Примечание"],
      widths: [18, 30, 16, 14, 10, 12, 14, 16, 30],
      rows: (priceList.data ?? []).map((p) => [
        contractNumber.get(p.contract_id) ?? null,
        ownerName(p.contract_id),
        vehicleTypeLabel(p.vehicle_type),
        p.vehicle_id ? (vehicleReg.get(p.vehicle_id) ?? null) : null,
        label(UNIT, p.unit),
        Number(p.price),
        dmy(p.valid_from),
        p.doc_type,
        p.note,
      ]),
    },
    {
      name: "Цены ГСМ",
      headers: ["Договор", "Контрагент", "Цена за литр, ₸", "Действует с", "Документ", "Примечание"],
      widths: [18, 30, 16, 14, 16, 30],
      rows: (fuelPrices.data ?? []).map((f) => [
        contractNumber.get(f.contract_id) ?? null,
        ownerName(f.contract_id),
        Number(f.price_per_liter),
        dmy(f.valid_from),
        f.doc_type,
        f.note,
      ]),
    },
    {
      name: "Топливные карты",
      headers: ["Номер / название", "Оператор АЗС", "Активна"],
      widths: [26, 20, 10],
      rows: (fuelCards.data ?? []).map((c) => [c.card_number, c.operator, yesNo(c.is_active)]),
    },
    {
      name: "Бензовозы",
      headers: ["Название", "Ёмкость, л", "Активен"],
      widths: [26, 14, 10],
      rows: (tankers.data ?? []).map((t) => [t.name, t.capacity_liters, yesNo(t.is_active)]),
    },
    {
      name: "Маршруты",
      headers: ["Маршрут", "Плечо, км", "Материал", "Объём, м³", "Подпись водителя", "Активен"],
      widths: [30, 12, 20, 12, 18, 10],
      rows: (routes.data ?? []).map((r) => [
        r.name,
        r.distance_km,
        r.material,
        r.volume_m3,
        yesNo(r.require_signature),
        yesNo(r.is_active),
      ]),
    },
    {
      name: "Виды работ",
      headers: ["Наименование", "Активен"],
      widths: [36, 10],
      rows: (workTypes.data ?? []).map((w) => [w.name, yesNo(w.is_active)]),
    },
    {
      name: "Простои",
      headers: ["Дата", "Машина", "Вина", "Причина", "Часы"],
      widths: [14, 14, 18, 40, 10],
      rows: (downtime.data ?? []).map((d) => [
        dmy(d.downtime_date),
        vehicleReg.get(d.vehicle_id) ?? null,
        label(FAULT, d.fault_side),
        d.reason,
        d.hours,
      ]),
    },
    {
      name: "Штрафы",
      headers: ["Дата", "Договор", "Контрагент", "Сумма, ₸", "Основание", "Удержан в периоде"],
      widths: [14, 18, 30, 14, 40, 20],
      rows: (penalties.data ?? []).map((p) => [
        dmy(p.penalty_date),
        contractNumber.get(p.contract_id) ?? null,
        ownerName(p.contract_id),
        Number(p.amount),
        p.reason,
        p.settled_in_period,
      ]),
    },
    {
      name: "Пользователи",
      headers: ["ФИО", "Роли", "Подрядчик (для портала)"],
      widths: [30, 40, 30],
      rows: (profiles.data ?? []).map((p) => [
        p.full_name,
        p.roles.map((r) => (isRole(r) ? ROLE_LABELS[r] : r)).join(", "),
        p.contractor_id ? (contractorName.get(p.contractor_id) ?? null) : null,
      ]),
    },
  ];
}
