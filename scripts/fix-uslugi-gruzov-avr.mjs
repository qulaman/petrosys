// Точечная правка данных для АВР по ИП «Услуги Грузов» (расчёт заказчика 20.07.2026):
//   1) 129 AMT — единственная машина скриншота без привязки → контрагент
//      «ИП Услуги Грузов», договор 08/07-01-УОП-2026 (тарифы 12000/14000/337).
//   2) Тарифы и цена ГСМ договора 08/07-01-УОП-2026 действуют с 08.07, но
//      заказчик считает ВЕСЬ июль по ним (часы машин идут с 01.07) →
//      сдвигаем valid_from на 2026-07-01.
//
//   node scripts/fix-uslugi-gruzov-avr.mjs            — dry-run
//   node scripts/fix-uslugi-gruzov-avr.mjs --commit   — запись
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes("--commit");
const CONTRACT_NUMBER = "08/07-01-УОП-2026";
const CONTRACTOR_NAME = "ИП Услуги Грузов";
const NEW_VALID_FROM = "2026-07-01";
const NOTE = "тарифы применяются с начала июля (расчёт заказчика 20.07)";

const env = {};
for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const check = (e, ctx) => { if (e) throw new Error(`${ctx}: ${e.message}`); };

const { data: contract, error: ce } = await db.from("contracts").select("id, number").eq("number", CONTRACT_NUMBER).single();
check(ce, "contract");
const { data: contractor, error: re } = await db.from("contractors").select("id, name").eq("name", CONTRACTOR_NAME).single();
check(re, "contractor");
const { data: veh, error: ve } = await db.from("vehicles").select("id, reg_number, contract_id, contractor_id").eq("reg_number", "129 AMT").single();
check(ve, "vehicle 129 AMT");
const { data: prices, error: pe } = await db.from("price_list").select("id, unit, price, valid_from").eq("contract_id", contract.id);
check(pe, "prices");
const { data: fuel, error: fe } = await db.from("contract_fuel_prices").select("id, price_per_liter, valid_from").eq("contract_id", contract.id);
check(fe, "fuel prices");

const priceShift = prices.filter((p) => p.valid_from > NEW_VALID_FROM);
const fuelShift = fuel.filter((p) => p.valid_from > NEW_VALID_FROM);
console.log(`129 AMT: договор сейчас ${veh.contract_id ? "есть" : "нет"} → привязка к ${contract.number} (${contractor.name})`);
console.log(`Прайс к сдвигу на ${NEW_VALID_FROM}: ${priceShift.map((p) => `${p.unit} ${p.price} (с ${p.valid_from})`).join("; ") || "нечего"}`);
console.log(`Цены ГСМ к сдвигу: ${fuelShift.map((p) => `${p.price_per_liter} (с ${p.valid_from})`).join("; ") || "нечего"}`);

if (!COMMIT) {
  console.log("\nDry-run: БД не изменена. Для записи: node scripts/fix-uslugi-gruzov-avr.mjs --commit");
  process.exit(0);
}

if (!veh.contract_id) {
  const { error } = await db.from("vehicles").update({ contractor_id: contractor.id, contract_id: contract.id }).eq("id", veh.id);
  check(error, "vehicle link");
}
for (const p of priceShift) {
  const { error } = await db.from("price_list").update({ valid_from: NEW_VALID_FROM, note: NOTE }).eq("id", p.id);
  check(error, "price shift");
}
for (const p of fuelShift) {
  const { error } = await db.from("contract_fuel_prices").update({ valid_from: NEW_VALID_FROM, note: NOTE }).eq("id", p.id);
  check(error, "fuel price shift");
}
console.log("Готово: привязка и сдвиг применены.");
