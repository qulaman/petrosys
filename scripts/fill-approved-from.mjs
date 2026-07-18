// ---------------------------------------------------------------------------
// QuarryOps · Заполнение допуска техники из договоров
//
// У машин, импортированных из договоров, не заполнен approved_from — из-за
// этого детектор «недопущенная техника» помечает каждую их смену.
// Скрипт ставит approved_from = valid_from договора машины (только там, где
// approved_from ещё NULL). Машины без договора не трогаются — они остаются
// в аномалиях осознанно.
//
// Запуск:  node scripts/fill-approved-from.mjs            (dry-run, только отчёт)
//          node scripts/fill-approved-from.mjs --commit   (запись в БД)
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes("--commit");

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
function check(error, ctx) { if (error) throw new Error(`${ctx}: ${error.message}`); }

async function main() {
  const env = loadEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const [{ data: vehicles, error: vErr }, { data: contracts, error: cErr }] = await Promise.all([
    db.from("vehicles").select("id, reg_number, approved_from, contract_id"),
    db.from("contracts").select("id, number, valid_from"),
  ]);
  check(vErr, "vehicles");
  check(cErr, "contracts");
  const byId = new Map(contracts.map((c) => [c.id, c]));

  const targets = vehicles
    .filter((v) => !v.approved_from && v.contract_id && byId.has(v.contract_id))
    .map((v) => ({ ...v, contract: byId.get(v.contract_id) }));
  const noContract = vehicles.filter((v) => !v.approved_from && !v.contract_id);

  console.log(`Машин всего: ${vehicles.length}; approved_from пуст: ${targets.length + noContract.length}`);
  console.log(`Заполняем из договора: ${targets.length}; без договора (не трогаем): ${noContract.length}`);
  for (const v of targets) console.log(`  ${v.reg_number}: approved_from ← ${v.contract.valid_from} (договор ${v.contract.number})`);
  if (noContract.length) console.log(`Без договора: ${noContract.map((v) => v.reg_number).join(", ")}`);

  if (!COMMIT) {
    console.log("\nDry-run. Для записи: node scripts/fill-approved-from.mjs --commit");
    return;
  }
  let done = 0;
  for (const v of targets) {
    const { error } = await db.from("vehicles").update({ approved_from: v.contract.valid_from }).eq("id", v.id).is("approved_from", null);
    check(error, v.reg_number);
    done += 1;
  }
  console.log(`\nЗаписано: ${done} машин.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
