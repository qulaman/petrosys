// Первичное наполнение штатных водителей машин (справочник АВР) из факта:
// по сменам июля берём доминирующего водителя машины отдельно для дня и ночи
// (⩾2/3 смен и не заглушка). Уже заполненные поля не трогаем.
//
//   node scripts/fill-vehicle-drivers.mjs            — dry-run
//   node scripts/fill-vehicle-drivers.mjs --commit   — запись
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes("--commit");
const PLACEHOLDER = "— не указан —";

const env = {};
for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: drivers } = await db.from("drivers").select("id, full_name");
const placeholder = drivers.find((d) => d.full_name === PLACEHOLDER)?.id;
const nameById = new Map(drivers.map((d) => [d.id, d.full_name]));

const { data: vehicles } = await db.from("vehicles").select("id, reg_number, day_driver_id, night_driver_id");

const shifts = [];
let page = 0;
for (;;) {
  const { data } = await db.from("shift_records")
    .select("vehicle_id, driver_id, shift_type").range(page * 1000, (page + 1) * 1000 - 1);
  shifts.push(...data);
  if (data.length < 1000) break;
  page++;
}

// vehicle → shift_type → Map(driver → n)
const votes = new Map();
for (const s of shifts) {
  if (!s.driver_id || s.driver_id === placeholder) continue;
  const key = `${s.vehicle_id}|${s.shift_type}`;
  const m = votes.get(key) ?? new Map();
  m.set(s.driver_id, (m.get(s.driver_id) ?? 0) + 1);
  votes.set(key, m);
}
const dominant = (m) => {
  if (!m) return null;
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const [best, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  return n / total >= 2 / 3 ? best : null;
};

const updates = [];
for (const v of vehicles) {
  const day = v.day_driver_id ?? dominant(votes.get(`${v.id}|day`));
  const night = v.night_driver_id ?? dominant(votes.get(`${v.id}|night`));
  if (day !== v.day_driver_id || night !== v.night_driver_id)
    updates.push({ id: v.id, reg: v.reg_number, day, night });
}

console.log(`Машин к заполнению: ${updates.length}`);
for (const u of updates)
  console.log(`  ${u.reg}: день=${u.day ? nameById.get(u.day) : "—"}, ночь=${u.night ? nameById.get(u.night) : "—"}`);

if (!COMMIT) {
  console.log("\nDry-run. Для записи: node scripts/fill-vehicle-drivers.mjs --commit");
  process.exit(0);
}
for (const u of updates) {
  const { error } = await db.from("vehicles")
    .update({ day_driver_id: u.day, night_driver_id: u.night }).eq("id", u.id);
  if (error) throw new Error(`${u.reg}: ${error.message}`);
}
console.log("Записано.");
