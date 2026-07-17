import "server-only";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { createAdminClient } from "@/lib/supabase/admin";
import { vehicleTypeLabel } from "@/lib/domain";

/**
 * Рендер docx-шаблона с плейсхолдерами (docxtemplater).
 * Синтаксис: {number}, {c_name}; цикл ставок: {#rates}{r_type} {r_unit} {r_price}{/rates}.
 */
export function renderTemplate(
  templateBuffer: Buffer,
  data: Record<string, unknown>,
): { ok: true; buffer: Buffer } | { ok: false; error: string } {
  try {
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "", // незаполненные поля → пусто, не ошибка
    });
    doc.render(data);
    const buffer = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
    return { ok: true, buffer };
  } catch (e) {
    // docxtemplater кладёт детали в properties.errors — переводим в понятный текст.
    const err = e as { properties?: { errors?: { properties?: { explanation?: string; xtag?: string } }[] }; message?: string };
    const details = (err.properties?.errors ?? [])
      .map((x) => x.properties?.explanation || x.properties?.xtag)
      .filter(Boolean)
      .join("; ");
    return { ok: false, error: details || err.message || "Ошибка рендера шаблона" };
  }
}

const UNIT_RU: Record<string, string> = { trip: "рейс", hour: "час" };
const fmtMoney = (v: number) => new Intl.NumberFormat("ru-RU").format(v);

export interface ContractTemplateInput {
  number: string;
  contract_type: string;
  billing_period: string;
  valid_from: string;
  valid_to: string | null;
  contractor: {
    name: string; bin?: string | null; legal_address?: string | null;
    bank_name?: string | null; iik?: string | null; bik?: string | null;
    head_name?: string | null; vat_payer: boolean;
  };
  rates: { vehicle_type: string; unit: string; price: number; vehicle_reg?: string | null }[];
  fuel_price: number | null;
}

/** Данные договора → плоский объект плейсхолдеров (см. справочник на экране шаблонов). */
export function contractTemplateData(d: ContractTemplateInput): Record<string, unknown> {
  return {
    number: d.number,
    contract_type: d.contract_type === "transportation" ? "перевозка грунта" : "услуги строительной техники",
    billing_period: d.billing_period === "15days" ? "каждые 15 дней" : "календарный месяц",
    valid_from: d.valid_from,
    valid_to: d.valid_to ?? "бессрочно",
    today: new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Aqtobe" }).format(new Date()),
    c_name: d.contractor.name,
    c_bin: d.contractor.bin ?? "",
    c_address: d.contractor.legal_address ?? "",
    c_bank: d.contractor.bank_name ?? "",
    c_iik: d.contractor.iik ?? "",
    c_bik: d.contractor.bik ?? "",
    c_head: d.contractor.head_name ?? "",
    c_vat: d.contractor.vat_payer ? "плательщик НДС (цены включают НДС)" : "не является плательщиком НДС",
    rates: d.rates.map((r) => ({
      r_type: `${vehicleTypeLabel(r.vehicle_type)}${r.vehicle_reg ? ` (${r.vehicle_reg})` : ""}`,
      r_unit: UNIT_RU[r.unit] ?? r.unit,
      r_price: `${fmtMoney(r.price)} ₸`,
    })),
    fuel_price: d.fuel_price != null ? `${fmtMoney(d.fuel_price)} ₸/л` : "не удерживается",
    has_fuel: d.fuel_price != null,
  };
}

/** Демо-данные для кнопки «Проверить шаблон». */
export function demoContractData(): Record<string, unknown> {
  return contractTemplateData({
    number: "ДЕМО-01/2026",
    contract_type: "transportation",
    billing_period: "15days",
    valid_from: "2026-07-01",
    valid_to: "2026-12-31",
    contractor: {
      name: "ИП «Демо Контрагент»", bin: "123456789012", legal_address: "г. Актобе, ул. Примерная 1",
      bank_name: "Halyk Bank", iik: "KZ00000000000000", bik: "HSBKKZKX",
      head_name: "Иванов И.И.", vat_payer: true,
    },
    rates: [
      { vehicle_type: "dump_truck", unit: "trip", price: 14000 },
      { vehicle_type: "dump_truck", unit: "hour", price: 12000 },
    ],
    fuel_price: 337,
  });
}

/** Активный шаблон по типу документа (и типу договора, если задан) → Buffer файла. */
export async function getActiveTemplate(
  docType: string,
  contractType?: string | null,
): Promise<{ id: string; buffer: Buffer } | null> {
  const admin = createAdminClient();
  let q = admin
    .from("document_templates")
    .select("id, file_url, contract_type")
    .eq("doc_type", docType)
    .eq("is_active", true)
    .order("updated_at", { ascending: false });
  const { data } = await q;
  const match =
    (data ?? []).find((t) => t.contract_type === contractType) ??
    (data ?? []).find((t) => t.contract_type == null);
  if (!match) return null;
  const file = await admin.storage.from("templates").download(match.file_url);
  if (file.error || !file.data) return null;
  return { id: match.id, buffer: Buffer.from(await file.data.arrayBuffer()) };
}
