"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { zUuid } from "@/lib/validation";
import { devError, IS_DEV } from "@/lib/dev-log";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");
type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(e: z.ZodError): Result {
  const msg = e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { ok: false, error: IS_DEV ? msg : "Проверьте поля" };
}

const contractSchema = z.object({
  contractor_id: zUuid,
  number: z.string().min(1),
  contract_type: z.enum(["transportation", "equipment"]),
  billing_period: z.enum(["monthly", "15days"]),
  valid_from: date,
  valid_to: date.nullable(),
  is_active: z.boolean(),
});

export async function upsertContract(
  id: string | null,
  input: z.infer<typeof contractSchema>,
): Promise<Result> {
  const p = contractSchema.safeParse(input);
  if (!p.success) return fail(p.error);
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("contracts").update(p.data).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/fleet/admin/contracts/${id}`);
    return { ok: true, id };
  }
  const { data, error } = await supabase.from("contracts").insert(p.data).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/fleet/admin/contracts");
  return { ok: true, id: data.id };
}

const priceSchema = z.object({
  vehicle_type: z.string().min(1),
  unit: z.enum(["trip", "hour"]),
  price: z.number().positive(),
  vehicle_id: zUuid.nullable(),
  valid_from: date,
  note: z.string().max(300).nullable(),
});

export async function addPriceRow(
  contractId: string,
  input: z.infer<typeof priceSchema>,
): Promise<Result> {
  const p = priceSchema.safeParse(input);
  if (!p.success) return fail(p.error);
  const supabase = await createClient();

  // По ТЗ: для договора «услуги техники» допустима только единица «час».
  const { data: c } = await supabase.from("contracts").select("contract_type").eq("id", contractId).single();
  if (c?.contract_type === "equipment" && p.data.unit === "trip")
    return { ok: false, error: "Для услуг техники допустима только единица «час»" };

  const { error } = await supabase.from("price_list").insert({ contract_id: contractId, ...p.data });
  if (error) { devError("addPriceRow", error); return { ok: false, error: error.message }; }
  revalidatePath(`/fleet/admin/contracts/${contractId}`);
  return { ok: true };
}

export async function deletePriceRow(id: string, contractId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("price_list").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/fleet/admin/contracts/${contractId}`);
  return { ok: true };
}

const fuelSchema = z.object({
  price_per_liter: z.number().positive(),
  valid_from: date,
  note: z.string().max(300).nullable(),
});

export async function addFuelPrice(
  contractId: string,
  input: z.infer<typeof fuelSchema>,
): Promise<Result> {
  const p = fuelSchema.safeParse(input);
  if (!p.success) return fail(p.error);
  const supabase = await createClient();
  const { error } = await supabase.from("contract_fuel_prices").insert({ contract_id: contractId, ...p.data });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/fleet/admin/contracts/${contractId}`);
  return { ok: true };
}

export async function deleteFuelPrice(id: string, contractId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.from("contract_fuel_prices").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/fleet/admin/contracts/${contractId}`);
  return { ok: true };
}

// -----------------------------------------------------------------------------
// 6.B — Мастер договора: договор + прайс + цена ГСМ + docx-пакет за один сабмит.
// Ключевое требование ТЗ: условия вводятся ОДИН раз — двойного ввода нет.
// -----------------------------------------------------------------------------
import { requireOfficeAdmin, saveGeneratedDocument } from "@/lib/documents/save";
import { appendix1Docx, appendix2Docx, contractDocx } from "@/lib/documents/builders";
import { contractTemplateData, renderTemplate, type ContractTemplateInput } from "@/lib/documents/render";
import { createAdminClient } from "@/lib/supabase/admin";
import { aqtobeDate } from "@/lib/tz";

/** Скачивает файл конкретного шаблона по id. */
async function fetchTemplateBuffer(templateId: string): Promise<Buffer | null> {
  const supabase = await createClient();
  const { data: t } = await supabase
    .from("document_templates")
    .select("file_url")
    .eq("id", templateId)
    .single();
  if (!t) return null;
  const admin = createAdminClient();
  const file = await admin.storage.from("templates").download(t.file_url);
  if (file.error || !file.data) return null;
  return Buffer.from(await file.data.arrayBuffer());
}

const wizardSchema = z.object({
  contractor_id: zUuid,
  number: z.string().min(1),
  contract_type: z.enum(["transportation", "equipment"]),
  billing_period: z.enum(["monthly", "15days"]),
  valid_from: date,
  valid_to: date.nullable(),
  rates: z
    .array(z.object({
      vehicle_type: z.string().min(1),
      unit: z.enum(["trip", "hour"]),
      price: z.number().positive(),
    }))
    .min(1, "Добавьте хотя бы одну ставку"),
  fuel_price: z.number().positive().nullable(),
  template_id: zUuid.nullable(), // null = встроенная форма
});

export async function createContractWithTerms(
  input: z.infer<typeof wizardSchema>,
): Promise<{ ok: true; id: string; docs: string[] } | { ok: false; error: string }> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;
  const p = wizardSchema.safeParse(input);
  if (!p.success) return fail(p.error) as { ok: false; error: string };
  const d = p.data;

  if (d.contract_type === "equipment" && d.rates.some((r) => r.unit === "trip"))
    return { ok: false, error: "Для услуг техники допустима только единица «час»" };

  const supabase = await createClient();

  // 1) Договор
  const { data: contract, error } = await supabase
    .from("contracts")
    .insert({
      contractor_id: d.contractor_id, number: d.number, contract_type: d.contract_type,
      billing_period: d.billing_period, valid_from: d.valid_from, valid_to: d.valid_to,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // 2) Прайс-лист и цена ГСМ (effective-dated от даты начала договора)
  const { error: pricesErr } = await supabase.from("price_list").insert(
    d.rates.map((r) => ({
      contract_id: contract.id, vehicle_type: r.vehicle_type, unit: r.unit,
      price: r.price, valid_from: d.valid_from,
    })),
  );
  if (pricesErr) return { ok: false, error: pricesErr.message };
  if (d.fuel_price != null) {
    const { error: fuelErr } = await supabase.from("contract_fuel_prices").insert({
      contract_id: contract.id, price_per_liter: d.fuel_price, valid_from: d.valid_from,
    });
    if (fuelErr) return { ok: false, error: fuelErr.message };
  }

  // 3) docx-пакет: договор + Приложение №1 + Приложение №2 (ред.1)
  const docs: string[] = [];
  try {
    const { data: contractor } = await supabase
      .from("contractors")
      .select("name, bin, legal_address, bank_name, iik, bik, head_name, vat_payer")
      .eq("id", d.contractor_id)
      .single();
    const docData = {
      number: d.number, contract_type: d.contract_type, billing_period: d.billing_period,
      valid_from: d.valid_from, valid_to: d.valid_to,
      contractor: { ...(contractor ?? { name: "—" }), vat_payer: contractor?.vat_payer ?? false },
      rates: d.rates.map((r) => ({ ...r, valid_from: d.valid_from })),
      fuelPrices: d.fuel_price != null ? [{ price_per_liter: d.fuel_price, valid_from: d.valid_from }] : [],
    };
    const today = aqtobeDate(new Date().toISOString());

    // Договор: по загруженному шаблону (docxtemplater) либо встроенной формой.
    let contractBuffer = contractDocx(docData);
    if (d.template_id) {
      const tplBuf = await fetchTemplateBuffer(d.template_id);
      if (tplBuf) {
        const rendered = renderTemplate(tplBuf, contractTemplateData({
          number: d.number, contract_type: d.contract_type, billing_period: d.billing_period,
          valid_from: d.valid_from, valid_to: d.valid_to,
          contractor: docData.contractor,
          rates: d.rates.map((r) => ({ ...r })),
          fuel_price: d.fuel_price,
        }));
        if (rendered.ok) contractBuffer = rendered.buffer;
        else devError("createContractWithTerms/template", rendered.error);
      }
    }

    const pack: { docType: "contract" | "appendix1" | "appendix2"; buffer: Buffer; numberOverride?: string }[] = [
      { docType: "contract", buffer: contractBuffer, numberOverride: `ДОГ ${d.number}` },
      { docType: "appendix1", buffer: appendix1Docx(docData), numberOverride: `П1 · ${d.number}` },
      {
        docType: "appendix2",
        buffer: appendix2Docx({ contractNumber: d.number, revision: 1, date: today, vehicles: [], drivers: [] }),
        numberOverride: `П2 ред.1 · ${d.number}`,
      },
    ];
    for (const doc of pack) {
      const res = await saveGeneratedDocument({
        orgId: gate.orgId, contractId: contract.id, docType: doc.docType,
        buffer: doc.buffer, ext: "docx", numberOverride: doc.numberOverride,
      });
      if (res.ok) docs.push(res.number);
    }
  } catch (e) {
    devError("createContractWithTerms/docs", e); // договор создан — документы можно перегенерировать
  }

  revalidatePath("/fleet/admin/contracts");
  revalidatePath("/fleet/office/documents");
  return { ok: true, id: contract.id, docs };
}

// -----------------------------------------------------------------------------
// Перегенерация docx договора по шаблону (для существующих договоров и после
// замены версии шаблона). Ставки/цена ГСМ — действующие на сегодня.
// -----------------------------------------------------------------------------
export async function regenerateContractDoc(
  contractId: string,
  templateId: string | null,
): Promise<{ ok: true; number: string } | { ok: false; error: string }> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const today = aqtobeDate(new Date().toISOString());

  const [contractRes, pricesRes, fuelRes, vehiclesRes] = await Promise.all([
    supabase.from("contracts").select("number, contract_type, billing_period, valid_from, valid_to, contractor_id").eq("id", contractId).single(),
    supabase.from("price_list").select("vehicle_type, unit, price, vehicle_id, valid_from").eq("contract_id", contractId).lte("valid_from", today),
    supabase.from("contract_fuel_prices").select("price_per_liter, valid_from").eq("contract_id", contractId).lte("valid_from", today).order("valid_from", { ascending: false }).limit(1),
    supabase.from("vehicles").select("id, reg_number"),
  ]);
  const c = contractRes.data;
  if (!c) return { ok: false, error: "Договор не найден" };
  const { data: contractor } = await supabase
    .from("contractors")
    .select("name, bin, legal_address, bank_name, iik, bik, head_name, vat_payer")
    .eq("id", c.contractor_id)
    .single();

  // действующая ставка на сегодня по каждой позиции (type, unit, vehicle)
  const latest = new Map<string, { vehicle_type: string; unit: string; price: number; vehicle_id: string | null; valid_from: string }>();
  for (const r of pricesRes.data ?? []) {
    const k = `${r.vehicle_type}|${r.unit}|${r.vehicle_id ?? ""}`;
    const cur = latest.get(k);
    if (!cur || cur.valid_from < r.valid_from) latest.set(k, { ...r, price: Number(r.price) });
  }
  const vMap = new Map((vehiclesRes.data ?? []).map((v) => [v.id, v.reg_number]));
  const input: ContractTemplateInput = {
    number: c.number, contract_type: c.contract_type, billing_period: c.billing_period,
    valid_from: c.valid_from, valid_to: c.valid_to,
    contractor: { ...(contractor ?? { name: "—" }), vat_payer: contractor?.vat_payer ?? false },
    rates: [...latest.values()].map((r) => ({
      vehicle_type: r.vehicle_type, unit: r.unit, price: r.price,
      vehicle_reg: r.vehicle_id ? vMap.get(r.vehicle_id) ?? null : null,
    })),
    fuel_price: fuelRes.data?.[0] ? Number(fuelRes.data[0].price_per_liter) : null,
  };

  let buffer: Buffer;
  if (templateId) {
    const tplBuf = await fetchTemplateBuffer(templateId);
    if (!tplBuf) return { ok: false, error: "Файл шаблона недоступен" };
    const rendered = renderTemplate(tplBuf, contractTemplateData(input));
    if (!rendered.ok) return { ok: false, error: `Ошибка шаблона: ${rendered.error}` };
    buffer = rendered.buffer;
  } else {
    buffer = contractDocx({
      ...input,
      rates: input.rates.map((r) => ({ ...r, valid_from: c.valid_from })),
      fuelPrices: input.fuel_price != null ? [{ price_per_liter: input.fuel_price, valid_from: c.valid_from }] : [],
    });
  }

  const res = await saveGeneratedDocument({
    orgId: gate.orgId, contractId, docType: "contract", buffer, ext: "docx",
    numberOverride: `ДОГ ${c.number} · ${today}`,
    sourceRefs: { template_id: templateId },
  });
  if (res.ok) {
    revalidatePath("/fleet/office/documents");
    revalidatePath("/portal/documents");
  }
  return res;
}
