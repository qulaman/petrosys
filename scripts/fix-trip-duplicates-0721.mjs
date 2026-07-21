// Удаление тестовых дублей рейсов 21.07.2026 (залп 09:20 с аккаунта заказчика —
// следствие бага с висящей геолокацией, см. коммит с фиксом). По каждой машине
// залпа оставляем ПЕРВЫЙ рейс, остальные удаляем.
//
//   node scripts/fix-trip-duplicates-0721.mjs            — dry-run
//   node scripts/fix-trip-duplicates-0721.mjs --commit   — удаление
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes("--commit");

const env = {};
for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
const customer = users.users.find((u) => u.email === "wsupkz@gmail.com");

// Залп: 21.07 14:20 Актобе (09:15–09:25 UTC)
const { data: trips, error } = await db.from("trip_records")
  .select("id, vehicle_id, created_at")
  .eq("recorded_by", customer.id)
  .gte("created_at", "2026-07-21T09:15:00Z")
  .lt("created_at", "2026-07-21T09:25:00Z")
  .order("created_at");
if (error) throw new Error(error.message);

const { data: veh } = await db.from("vehicles").select("id, reg_number");
const vn = new Map(veh.map((v) => [v.id, v.reg_number]));

const seen = new Set();
const toDelete = [];
for (const t of trips) {
  if (seen.has(t.vehicle_id)) toDelete.push(t);
  else seen.add(t.vehicle_id);
}
console.log(`Рейсов в залпе: ${trips.length}; оставляем по одному на машину; удаляем ${toDelete.length}:`);
for (const t of toDelete) console.log(`  ${vn.get(t.vehicle_id)} ${t.created_at}`);

if (!COMMIT) {
  console.log("\nDry-run. Для удаления: node scripts/fix-trip-duplicates-0721.mjs --commit");
  process.exit(0);
}
if (toDelete.length) {
  const { error: de } = await db.from("trip_records").delete().in("id", toDelete.map((t) => t.id));
  if (de) throw new Error(de.message);
}
console.log("Удалено.");
