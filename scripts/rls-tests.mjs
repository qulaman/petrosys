// Прогон RLS-тестов перед релизом:
//   node scripts/rls-tests.mjs
// Требует .env.local (ключи) и админа wsupkz@gmail.com. Код выхода 1 при провале.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SR = env.SUPABASE_SERVICE_ROLE_KEY;
const ORG = "00000000-0000-0000-0000-000000000001";

let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗ FAIL"}  ${name}`); if (!ok) failed++; };

const admin = createClient(URL_, SR);

// 1. Аноним не видит ничего
const anon = createClient(URL_, ANON);
for (const t of ["profiles", "fuel_issues", "vehicles", "contracts", "anomalies"]) {
  const { data } = await anon.from(t).select("id").limit(5);
  check(`аноним не видит ${t}`, (data ?? []).length === 0);
}

// 2. Подрядчик видит только своё, писать не может.
// Сид-подрядчики удалены июльским импортом — создаём временного с одной машиной.
const suffix = crypto.randomUUID().slice(0, 6);
const tc = await admin.from("contractors")
  .insert({ org_id: ORG, name: `RLS тест ${suffix}` })
  .select("id").single();
if (tc.error) { console.error("не удалось создать тест-подрядчика:", tc.error.message); process.exit(1); }
const TEST_CTR = tc.data.id;
const tv = await admin.from("vehicles")
  .insert({ org_id: ORG, contractor_id: TEST_CTR, brand: "RLS", reg_number: `RLS ${suffix}`, vehicle_type: "other", accounting_type: "hours" })
  .select("id").single();
if (tv.error) { console.error("не удалось создать тест-машину:", tv.error.message); process.exit(1); }

const email = `rls-test-${suffix}@example.com`;
const cu = await admin.auth.admin.createUser({
  email, password: "test1234", email_confirm: true,
  user_metadata: { full_name: "RLS тест", roles: ["contractor"], org_id: ORG, contractor_id: TEST_CTR },
});
if (cu.error) { console.error("не удалось создать тест-пользователя:", cu.error.message); process.exit(1); }
await new Promise((r) => setTimeout(r, 300));
const ctr = createClient(URL_, ANON);
await ctr.auth.signInWithPassword({ email, password: "test1234" });

const veh = await ctr.from("vehicles").select("contractor_id");
check("подрядчик видит только свою технику", (veh.data ?? []).every((v) => v.contractor_id === TEST_CTR) && (veh.data ?? []).length > 0);
const con = await ctr.from("contracts").select("contractor_id");
check("подрядчик видит только свои договоры", (con.data ?? []).every((c) => c.contractor_id === TEST_CTR));
const cards = await ctr.from("fuel_cards").select("id");
check("подрядчик не видит топливные карты", (cards.data ?? []).length === 0);
const anom = await ctr.from("anomalies").select("id");
check("подрядчик не видит аномалии", (anom.data ?? []).length === 0);
const ins = await ctr.from("trip_records").insert({
  route_id: "90000000-0000-0000-0000-000000000001",
  vehicle_id: "30000000-0000-0000-0000-000000000004",
  driver_id: "40000000-0000-0000-0000-000000000004",
});
check("подрядчик не может создавать записи", !!ins.error);
const tpl = await ctr.from("document_templates").select("id");
check("подрядчик не видит шаблоны", (tpl.data ?? []).length === 0);
const lu = await ctr.from("trip_lineups").select("id");
check("подрядчик не видит вывод на линию", (lu.data ?? []).length === 0);
const luIns = await ctr.from("trip_lineups").insert({ work_date: "2026-01-01", shift_type: "day" });
check("подрядчик не может создать вывод на линию", !!luIns.error);

await admin.auth.admin.deleteUser(cu.data.user.id);
await admin.from("vehicles").delete().eq("id", tv.data.id);
await admin.from("contractors").delete().eq("id", TEST_CTR);

// 3. Storage: чужой org-путь запрещён (под админом)
const adm = createClient(URL_, ANON);
await adm.auth.signInWithPassword({ email: "wsupkz@gmail.com", password: "qulaman" });
const bad = await adm.storage.from("signatures").upload(`foreign-org/${crypto.randomUUID()}.png`, Buffer.from("x"), { contentType: "image/png" });
check("upload в чужой org-путь блокирован", !!bad.error);

console.log(failed ? `\nПровалено проверок: ${failed}` : "\nВсе RLS-проверки пройдены.");
process.exit(failed ? 1 : 0);
