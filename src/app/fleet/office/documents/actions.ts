"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePeriod } from "@/lib/journals/period";
import { loadSettlement } from "@/lib/data/settlement";
import { buildSettlementWorkbook } from "@/lib/documents/act-xlsx";
import { requireOfficeAdmin, saveGeneratedDocument } from "@/lib/documents/save";
import {
  amendmentDocx, appendix2Docx, buildAvrXlsx, buildFuelStatementXlsx,
  buildTripRegisterXlsx, claimDocx, downtimeActDocx,
} from "@/lib/documents/builders";
import { aqtobeDate } from "@/lib/tz";
import { fmtDateTime } from "@/lib/format";
import { devError } from "@/lib/dev-log";

type Result = { ok: true; number: string } | { ok: false; error: string };
type MultiResult = { ok: true; numbers: string[] } | { ok: false; error: string };

function refresh() {
  revalidatePath("/fleet/office/documents");
  revalidatePath("/portal/documents");
}

/** Акт сверки (одиночный) — как раньше, через общий сейвер. */
export async function generateReconciliationAct(
  contractId: string,
  sp: { period?: string; from?: string; to?: string },
): Promise<Result> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;
  try {
    const period = resolvePeriod(sp);
    const s = await loadSettlement(contractId, period);
    if (!s) return { ok: false, error: "Договор не найден" };
    const buf = await buildSettlementWorkbook(s);
    const res = await saveGeneratedDocument({
      orgId: gate.orgId, contractId, docType: "reconciliation_act", buffer: buf, ext: "xlsx",
      periodFrom: s.period.from, periodTo: s.period.to,
    });
    if (res.ok) refresh();
    return res;
  } catch (e) {
    devError("generateReconciliationAct", e);
    return { ok: false, error: "Не удалось сформировать документ" };
  }
}

/** 6.A — Пакет закрытия: АВР + акт сверки + реестр рейсов + ведомость ГСМ. */
export async function generateClosingPackage(
  contractId: string,
  sp: { period?: string; from?: string; to?: string },
): Promise<MultiResult> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;
  try {
    const period = resolvePeriod(sp);
    const supabase = await createClient();

    const [s, contractRes, vehiclesRes, driversRes, routesRes] = await Promise.all([
      loadSettlement(contractId, period),
      supabase.from("contracts").select("number, contractor_id").eq("id", contractId).single(),
      supabase.from("vehicles").select("id, reg_number").eq("contract_id", contractId),
      supabase.from("drivers").select("id, full_name"),
      supabase.from("routes").select("id, name"),
    ]);
    if (!s || !contractRes.data) return { ok: false, error: "Договор не найден" };

    const { data: contractor } = await supabase
      .from("contractors")
      .select("name, bin, legal_address, bank_name, iik, bik, head_name, vat_payer")
      .eq("id", contractRes.data.contractor_id)
      .single();

    const vehIds = (vehiclesRes.data ?? []).map((v) => v.id);
    const vMap = new Map((vehiclesRes.data ?? []).map((v) => [v.id, v.reg_number]));
    const dMap = new Map((driversRes.data ?? []).map((d) => [d.id, d.full_name]));
    const rMap = new Map((routesRes.data ?? []).map((r) => [r.id, r.name]));
    const noVeh = vehIds.length ? vehIds : ["00000000-0000-0000-0000-000000000000"];

    const [tripsRes, fuelRes] = await Promise.all([
      supabase.from("trip_records").select("created_at, vehicle_id, driver_id, route_id").in("vehicle_id", noVeh).gte("created_at", period.fromISO).lt("created_at", period.toISO).order("created_at"),
      supabase.from("fuel_issues").select("created_at, vehicle_id, driver_id, liters, source_type").in("vehicle_id", noVeh).gte("created_at", period.fromISO).lt("created_at", period.toISO).order("created_at"),
    ]);

    const party = { ...(contractor ?? { name: "—" }), vat_payer: contractor?.vat_payer ?? false };
    const numbers: string[] = [];

    // АВР
    const avrBuf = await buildAvrXlsx({
      number: "", contractNumber: contractRes.data.number, contractor: party,
      periodFrom: s.period.from, periodTo: s.period.to,
      lines: s.accrual, total: s.totals.accrual, vat: s.totals.vat,
    });
    // Акт сверки
    const actBuf = await buildSettlementWorkbook(s);
    // Реестр рейсов
    const tripBuf = await buildTripRegisterXlsx({
      number: "", contractNumber: contractRes.data.number,
      periodFrom: s.period.from, periodTo: s.period.to,
      rows: (tripsRes.data ?? []).map((t) => ({
        at: fmtDateTime(t.created_at), reg: vMap.get(t.vehicle_id) ?? "—",
        driver: dMap.get(t.driver_id) ?? "—", route: rMap.get(t.route_id) ?? "—",
      })),
    });
    // Ведомость ГСМ
    const fuelBuf = await buildFuelStatementXlsx({
      number: "", contractNumber: contractRes.data.number,
      periodFrom: s.period.from, periodTo: s.period.to,
      rows: (fuelRes.data ?? []).map((f) => ({
        at: fmtDateTime(f.created_at), reg: vMap.get(f.vehicle_id) ?? "—",
        driver: dMap.get(f.driver_id) ?? "—", liters: Number(f.liters),
        source: f.source_type === "card" ? "Карта" : "Бензовоз",
      })),
    });

    const docs = [
      { docType: "avr" as const, buffer: avrBuf },
      { docType: "reconciliation_act" as const, buffer: actBuf },
      { docType: "trip_register" as const, buffer: tripBuf },
      { docType: "fuel_statement" as const, buffer: fuelBuf },
    ];
    for (const d of docs) {
      const res = await saveGeneratedDocument({
        orgId: gate.orgId, contractId, docType: d.docType, buffer: d.buffer, ext: "xlsx",
        periodFrom: s.period.from, periodTo: s.period.to,
      });
      if (!res.ok) return res;
      numbers.push(res.number);
    }
    refresh();
    return { ok: true, numbers };
  } catch (e) {
    devError("generateClosingPackage", e);
    return { ok: false, error: "Не удалось сформировать пакет" };
  }
}

/** 6.C — Приложение №2: списки техники/операторов, автоинкремент редакции. */
export async function generateAppendix2(contractId: string): Promise<Result> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;
  try {
    const supabase = await createClient();
    const [contractRes, vehiclesRes, driversRes, countRes] = await Promise.all([
      supabase.from("contracts").select("number").eq("id", contractId).single(),
      supabase.from("vehicles").select("reg_number, brand, vehicle_type, approved_from").eq("contract_id", contractId).eq("is_active", true).order("reg_number"),
      supabase.from("drivers").select("full_name, iin, approved_from").eq("contract_id", contractId).eq("is_active", true).order("full_name"),
      supabase.from("generated_documents").select("id", { count: "exact", head: true }).eq("contract_id", contractId).eq("doc_type", "appendix2"),
    ]);
    if (!contractRes.data) return { ok: false, error: "Договор не найден" };

    const revision = (countRes.count ?? 0) + 1;
    const today = aqtobeDate(new Date().toISOString());
    const buf = appendix2Docx({
      contractNumber: contractRes.data.number, revision, date: today,
      vehicles: vehiclesRes.data ?? [], drivers: driversRes.data ?? [],
    });
    const res = await saveGeneratedDocument({
      orgId: gate.orgId, contractId, docType: "appendix2", buffer: buf, ext: "docx",
      numberOverride: `П2 ред.${revision} · ${contractRes.data.number}`,
      sourceRefs: { revision },
    });
    if (res.ok) refresh();
    return res;
  } catch (e) {
    devError("generateAppendix2", e);
    return { ok: false, error: "Не удалось сформировать Приложение №2" };
  }
}

/** 6.D — Доп. соглашение: ставки/цена ГСМ, действующие с указанной даты. */
export async function generateAmendment(
  contractId: string,
  validFrom: string,
): Promise<Result> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;
  try {
    const supabase = await createClient();
    const [contractRes, pricesRes, fuelRes, vehiclesRes] = await Promise.all([
      supabase.from("contracts").select("number, contractor_id").eq("id", contractId).single(),
      supabase.from("price_list").select("vehicle_type, unit, price, vehicle_id, valid_from").eq("contract_id", contractId).eq("valid_from", validFrom),
      supabase.from("contract_fuel_prices").select("price_per_liter").eq("contract_id", contractId).eq("valid_from", validFrom),
      supabase.from("vehicles").select("id, reg_number"),
    ]);
    if (!contractRes.data) return { ok: false, error: "Договор не найден" };
    if (!pricesRes.data?.length && !fuelRes.data?.length)
      return { ok: false, error: `Нет изменений с датой ${validFrom}` };

    const { data: contractor } = await supabase.from("contractors").select("name").eq("id", contractRes.data.contractor_id).single();
    const vMap = new Map((vehiclesRes.data ?? []).map((v) => [v.id, v.reg_number]));

    const buf = amendmentDocx({
      contractNumber: contractRes.data.number,
      contractorName: contractor?.name ?? "—",
      validFrom,
      rates: (pricesRes.data ?? []).map((r) => ({
        vehicle_type: r.vehicle_type, unit: r.unit, price: Number(r.price),
        vehicle_reg: r.vehicle_id ? vMap.get(r.vehicle_id) ?? null : null, valid_from: validFrom,
      })),
      fuelPrices: (fuelRes.data ?? []).map((f) => ({ price_per_liter: Number(f.price_per_liter) })),
    });
    const res = await saveGeneratedDocument({
      orgId: gate.orgId, contractId, docType: "amendment", buffer: buf, ext: "docx",
      sourceRefs: { valid_from: validFrom },
    });
    if (res.ok) refresh();
    return res;
  } catch (e) {
    devError("generateAmendment", e);
    return { ok: false, error: "Не удалось сформировать доп. соглашение" };
  }
}

/** 6.E — Претензия из аномалии over_norm (с расчётом перерасхода). */
export async function generateClaim(anomalyId: string): Promise<Result> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;
  try {
    const supabase = await createClient();
    const { data: a } = await supabase.from("anomalies").select("type, entity_refs").eq("id", anomalyId).single();
    if (!a || a.type !== "over_norm") return { ok: false, error: "Претензия доступна только для «расход выше норматива»" };
    const refs = (a.entity_refs ?? {}) as { vehicle_id?: string; actual?: number; norm?: number; month?: string };
    if (!refs.vehicle_id || !refs.month) return { ok: false, error: "В сигнале нет данных для расчёта" };

    const { data: v } = await supabase.from("vehicles").select("reg_number, contract_id").eq("id", refs.vehicle_id).single();
    if (!v?.contract_id) return { ok: false, error: "У машины не задан договор" };

    const monthStart = `${refs.month}-01`;
    const [y, m] = refs.month.split("-").map(Number);
    const nextMonth = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;

    const [contractRes, shiftsRes, fuelRes, priceRes] = await Promise.all([
      supabase.from("contracts").select("number, contractor_id").eq("id", v.contract_id).single(),
      supabase.from("shift_records").select("hours").eq("vehicle_id", refs.vehicle_id).gte("shift_date", monthStart).lt("shift_date", nextMonth),
      supabase.from("fuel_issues").select("liters").eq("vehicle_id", refs.vehicle_id).gte("created_at", `${monthStart}T00:00:00+05:00`).lt("created_at", `${nextMonth}T00:00:00+05:00`),
      supabase.from("contract_fuel_prices").select("price_per_liter, valid_from").eq("contract_id", v.contract_id).lte("valid_from", monthStart).order("valid_from", { ascending: false }).limit(1),
    ]);
    const { data: contractor } = await supabase.from("contractors").select("name").eq("id", contractRes.data?.contractor_id ?? "").single();

    const hours = (shiftsRes.data ?? []).reduce((s, r) => s + Number(r.hours), 0);
    const liters = (fuelRes.data ?? []).reduce((s, r) => s + Number(r.liters), 0);
    const norm = Number(refs.norm ?? 0);
    const actual = Number(refs.actual ?? (hours > 0 ? liters / hours : 0));
    const overLiters = Math.max(0, liters - norm * hours);

    const buf = claimDocx({
      contractNumber: contractRes.data?.number ?? "—",
      contractorName: contractor?.name ?? "—",
      reg: v.reg_number, month: refs.month, actual, norm, hours, liters, overLiters,
      pricePerLiter: priceRes.data?.[0] ? Number(priceRes.data[0].price_per_liter) : null,
    });
    const res = await saveGeneratedDocument({
      orgId: gate.orgId, contractId: v.contract_id, docType: "claim_overconsumption",
      buffer: buf, ext: "docx", periodFrom: monthStart,
      sourceRefs: { anomaly_id: anomalyId },
    });
    if (!res.ok) return res;
    await supabase.from("anomalies").update({ status: "confirmed" }).eq("id", anomalyId);
    refresh();
    revalidatePath("/fleet/dashboard/anomalies");
    return res;
  } catch (e) {
    devError("generateClaim", e);
    return { ok: false, error: "Не удалось сформировать претензию" };
  }
}

/** 6.F — Акт простоя из записи справочника простоев. */
export async function generateDowntimeAct(recordId: string): Promise<Result> {
  const gate = await requireOfficeAdmin();
  if (!gate.ok) return gate;
  try {
    const supabase = await createClient();
    const { data: r } = await supabase
      .from("downtime_records")
      .select("vehicle_id, downtime_date, fault_side, reason, hours, notified_at")
      .eq("id", recordId)
      .single();
    if (!r) return { ok: false, error: "Запись простоя не найдена" };

    const { data: v } = await supabase.from("vehicles").select("reg_number, contract_id").eq("id", r.vehicle_id).single();
    const contractId = v?.contract_id ?? null;
    const { data: c } = contractId
      ? await supabase.from("contracts").select("number").eq("id", contractId).single()
      : { data: null };

    // Правило 18:00: компенсация — если уведомили ПОЗЖЕ 18:00 предыдущего дня.
    let compensable = false;
    if (r.fault_side === "client") {
      if (!r.notified_at) compensable = true;
      else {
        const deadline = new Date(`${r.downtime_date}T18:00:00+05:00`);
        deadline.setDate(deadline.getDate() - 1);
        compensable = new Date(r.notified_at) > deadline;
      }
    }

    const buf = downtimeActDocx({
      contractNumber: c?.number ?? null, reg: v?.reg_number ?? "—",
      date: r.downtime_date, faultSide: r.fault_side, reason: r.reason,
      hours: r.hours == null ? null : Number(r.hours),
      notifiedAt: r.notified_at ? fmtDateTime(r.notified_at) : null,
      compensable,
    });
    if (!contractId) return { ok: false, error: "У машины не задан договор — акт не к чему привязать" };
    const res = await saveGeneratedDocument({
      orgId: gate.orgId, contractId, docType: "downtime_act", buffer: buf, ext: "docx",
      periodFrom: r.downtime_date, sourceRefs: { downtime_id: recordId },
    });
    if (res.ok) refresh();
    return res;
  } catch (e) {
    devError("generateDowntimeAct", e);
    return { ok: false, error: "Не удалось сформировать акт простоя" };
  }
}

/** Signed URL для скачивания документа (office/admin — любой; contractor — свой через RLS). */
export async function getDocumentUrl(
  docId: string,
): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("generated_documents")
    .select("file_url")
    .eq("id", docId)
    .single();
  if (!doc?.file_url) return { error: "Документ не найден" };

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("documents").createSignedUrl(doc.file_url, 3600);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
