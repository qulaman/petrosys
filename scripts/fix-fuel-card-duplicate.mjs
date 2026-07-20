// Слияние дубля топливной карты (20.07.2026): импорт создал «Карта ГСМ» рядом
// с существующим «Счёт АЗС» (решение заказчика 17.07 — один счёт АЗС).
// Выдачи перевешиваем на «Счёт АЗС», дубль удаляем.
//
//   node scripts/fix-fuel-card-duplicate.mjs            — dry-run
//   node scripts/fix-fuel-card-duplicate.mjs --commit   — запись
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
const check = (e, ctx) => { if (e) throw new Error(`${ctx}: ${e.message}`); };

const { data: keep, error: e1 } = await db.from("fuel_cards").select("id").eq("card_number", "Счёт АЗС").single();
check(e1, "Счёт АЗС");
const { data: dup, error: e2 } = await db.from("fuel_cards").select("id").eq("card_number", "Карта ГСМ").maybeSingle();
check(e2, "Карта ГСМ");
if (!dup) { console.log("Дубля «Карта ГСМ» нет — нечего сливать."); process.exit(0); }

const { count } = await db.from("fuel_issues").select("id", { count: "exact", head: true }).eq("fuel_card_id", dup.id);
const { count: tx } = await db.from("card_transactions").select("id", { count: "exact", head: true }).eq("fuel_card_id", dup.id);
console.log(`Перевесить на «Счёт АЗС»: выдач ${count}, транзакций ${tx}; затем удалить «Карта ГСМ».`);

if (!COMMIT) { console.log("\nDry-run. Для записи: node scripts/fix-fuel-card-duplicate.mjs --commit"); process.exit(0); }

const { error: u1 } = await db.from("fuel_issues").update({ fuel_card_id: keep.id }).eq("fuel_card_id", dup.id);
check(u1, "fuel_issues update");
if (tx) {
  const { error: u2 } = await db.from("card_transactions").update({ fuel_card_id: keep.id }).eq("fuel_card_id", dup.id);
  check(u2, "card_transactions update");
}
const { error: d1 } = await db.from("fuel_cards").delete().eq("id", dup.id);
check(d1, "fuel_cards delete");
console.log("Готово: выдачи на «Счёт АЗС», дубль удалён.");
