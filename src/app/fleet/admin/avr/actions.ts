"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { devError } from "@/lib/dev-log";

type Result = { ok: true } | { ok: false; error: string };

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Неверная дата");
const zDoc = z.enum(["contract", "addendum", "manual"]);
const zId = z.string().min(30, "Неверный id");

async function requireOffice(): Promise<{ error?: string; orgId?: string }> {
  const current = await getCurrentProfile();
  const roles = current?.profile?.roles ?? [];
  if (!roles.includes("admin") && !roles.includes("office")) return { error: "Недостаточно прав" };
  const orgId = current?.profile?.org_id;
  if (!orgId) return { error: "Нет организации" };
  return { orgId };
}

// найти водителя по ФИО или создать
async function driverIdByName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string | null | undefined,
): Promise<string | null> {
  const fio = name?.trim().replace(/\s+/g, " ");
  if (!fio) return null;
  const { data: found } = await supabase.from("drivers").select("id").ilike("full_name", fio).limit(1);
  if (found?.length) return found[0].id;
  const { data: created, error } = await supabase
    .from("drivers").insert({ full_name: fio, is_active: true }).select("id").single();
  if (error) throw error;
  return created.id;
}

// -----------------------------------------------------------------------------
// Новая версия условий машины (час/рейс — точечно на машину, ГСМ — на договор)
// -----------------------------------------------------------------------------
const zVersion = z
  .object({
    vehicle_id: zId,
    valid_from: zDate,
    hour_price: z.number().positive().max(10_000_000).nullable(),
    trip_price: z.number().positive().max(10_000_000).nullable(),
    fuel_price: z.number().positive().max(100_000).nullable(),
    doc_type: zDoc,
  })
  .refine((v) => v.hour_price != null || v.trip_price != null || v.fuel_price != null, {
    message: "Укажите хотя бы одну цену",
  });

export async function addRateVersion(input: unknown): Promise<Result> {
  const p = zVersion.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Проверьте поля" };
  const auth = await requireOffice();
  if (auth.error) return { ok: false, error: auth.error };

  const supabase = await createClient();
  const { data: v } = await supabase
    .from("vehicles").select("id, vehicle_type, contract_id").eq("id", p.data.vehicle_id).single();
  if (!v?.contract_id) return { ok: false, error: "Машина не привязана к договору — используйте «Заполнить»" };

  try {
    const rateRows = (["hour", "trip"] as const)
      .filter((u) => (u === "hour" ? p.data.hour_price : p.data.trip_price) != null)
      .map((u) => ({
        contract_id: v.contract_id!,
        vehicle_id: v.id,
        vehicle_type: v.vehicle_type,
        unit: u,
        price: u === "hour" ? p.data.hour_price! : p.data.trip_price!,
        valid_from: p.data.valid_from,
        doc_type: p.data.doc_type,
        note: "справочник АВР",
      }));
    if (rateRows.length) {
      const { error } = await supabase.from("price_list").insert(rateRows);
      if (error) throw error;
    }
    if (p.data.fuel_price != null) {
      const { error } = await supabase.from("contract_fuel_prices").insert({
        contract_id: v.contract_id,
        price_per_liter: p.data.fuel_price,
        valid_from: p.data.valid_from,
        doc_type: p.data.doc_type,
        note: "справочник АВР (цена на весь договор)",
      });
      if (error) throw error;
    }
  } catch (e) {
    devError("addRateVersion", e);
    return { ok: false, error: "Не удалось сохранить условия" };
  }
  revalidatePath("/fleet/admin/avr");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Водители машины (день/ночь) — по ФИО, несуществующие создаются
// -----------------------------------------------------------------------------
const zDrivers = z.object({
  vehicle_id: zId,
  day_name: z.string().max(120).nullable(),
  night_name: z.string().max(120).nullable(),
});

export async function setVehicleDrivers(input: unknown): Promise<Result> {
  const p = zDrivers.safeParse(input);
  if (!p.success) return { ok: false, error: "Проверьте поля" };
  const auth = await requireOffice();
  if (auth.error) return { ok: false, error: auth.error };

  const supabase = await createClient();
  try {
    const [day, night] = await Promise.all([
      driverIdByName(supabase, p.data.day_name),
      driverIdByName(supabase, p.data.night_name),
    ]);
    const { error } = await supabase
      .from("vehicles")
      .update({ day_driver_id: day, night_driver_id: night })
      .eq("id", p.data.vehicle_id);
    if (error) throw error;
  } catch (e) {
    devError("setVehicleDrivers", e);
    return { ok: false, error: "Не удалось сохранить водителей" };
  }
  revalidatePath("/fleet/admin/avr");
  return { ok: true };
}

// -----------------------------------------------------------------------------
// «Заполнить»: привязка машины без ИП/условий — контрагент (или новый),
// договор (или новый), первая версия условий, водители — одной формой.
// -----------------------------------------------------------------------------
const zAttach = z
  .object({
    vehicle_id: zId,
    contractor_id: zId.nullable(),
    new_contractor_name: z.string().max(200).nullable(),
    new_contractor_bin: z.string().max(12).nullable(),
    new_contractor_vat: z.boolean(),
    contract_id: zId.nullable(),
    new_contract_number: z.string().max(120).nullable(),
    valid_from: zDate,
    hour_price: z.number().positive().max(10_000_000).nullable(),
    trip_price: z.number().positive().max(10_000_000).nullable(),
    fuel_price: z.number().positive().max(100_000).nullable(),
    doc_type: zDoc,
    day_name: z.string().max(120).nullable(),
    night_name: z.string().max(120).nullable(),
  })
  .refine((v) => v.contractor_id || v.new_contractor_name?.trim(), { message: "Выберите ИП или введите нового" })
  .refine((v) => v.contract_id || v.new_contract_number?.trim(), { message: "Выберите договор или введите номер нового" })
  .refine((v) => v.hour_price != null || v.trip_price != null, { message: "Укажите цену часа и/или рейса" });

export async function attachVehicle(input: unknown): Promise<Result> {
  const p = zAttach.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Проверьте поля" };
  const auth = await requireOffice();
  if (auth.error) return { ok: false, error: auth.error };
  const d = p.data;

  const supabase = await createClient();
  try {
    const { data: v } = await supabase
      .from("vehicles").select("id, vehicle_type, approved_from").eq("id", d.vehicle_id).single();
    if (!v) return { ok: false, error: "Машина не найдена" };

    let contractorId = d.contractor_id;
    if (!contractorId) {
      const { data: c, error } = await supabase.from("contractors").insert({
        name: d.new_contractor_name!.trim(),
        bin: d.new_contractor_bin?.trim() || null,
        vat_payer: d.new_contractor_vat,
        is_active: true,
      }).select("id").single();
      if (error) throw error;
      contractorId = c.id;
    }

    let contractId = d.contract_id;
    if (!contractId) {
      const { data: c, error } = await supabase.from("contracts").insert({
        contractor_id: contractorId,
        number: d.new_contract_number!.trim(),
        contract_type: "transportation",
        billing_period: "monthly",
        valid_from: d.valid_from,
      }).select("id").single();
      if (error) throw error;
      contractId = c.id;
    }

    const [day, night] = await Promise.all([
      driverIdByName(supabase, d.day_name),
      driverIdByName(supabase, d.night_name),
    ]);
    const { error: vErr } = await supabase.from("vehicles").update({
      contractor_id: contractorId,
      contract_id: contractId,
      approved_from: v.approved_from ?? d.valid_from,
      ...(day ? { day_driver_id: day } : {}),
      ...(night ? { night_driver_id: night } : {}),
    }).eq("id", d.vehicle_id);
    if (vErr) throw vErr;

    const rateRows = (["hour", "trip"] as const)
      .filter((u) => (u === "hour" ? d.hour_price : d.trip_price) != null)
      .map((u) => ({
        contract_id: contractId!,
        vehicle_id: d.vehicle_id,
        vehicle_type: v.vehicle_type,
        unit: u,
        price: u === "hour" ? d.hour_price! : d.trip_price!,
        valid_from: d.valid_from,
        doc_type: d.doc_type,
        note: "справочник АВР",
      }));
    if (rateRows.length) {
      const { error } = await supabase.from("price_list").insert(rateRows);
      if (error) throw error;
    }
    if (d.fuel_price != null) {
      const { error } = await supabase.from("contract_fuel_prices").insert({
        contract_id: contractId,
        price_per_liter: d.fuel_price,
        valid_from: d.valid_from,
        doc_type: d.doc_type,
        note: "справочник АВР",
      });
      if (error) throw error;
    }
  } catch (e) {
    devError("attachVehicle", e);
    return { ok: false, error: "Не удалось привязать машину" };
  }
  revalidatePath("/fleet/admin/avr");
  return { ok: true };
}
