// Импорт истории сводок геодезиста (21.05–15.07.2026) из очищенного CSV
// docs/прогноз работ/istoricheskie_dannye_m3.csv в production_facts.
//
//   node scripts/import-m3-history.mjs            — dry-run
//   node scripts/import-m3-history.mjs --commit   — запись (upsert-безопасно:
//                                                   существующие дата+смена+поток пропускаются)
//
// Правила: строки без объёма, но с рейсами — объём оценивается 19 м³/рейс
// (стабильное фактическое среднее) с пометкой в note; «простой_погода» →
// day_status=downtime_weather.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(here, "..", "docs", "прогноз работ", "istoricheskie_dannye_m3.csv");
const ORG_ID = "00000000-0000-0000-0000-000000000001";
const COMMIT = process.argv.includes("--commit");

const FLOW_BY_TEXT = [
  [/накопител/i, "stockpile"],
  [/ПРС/i, "prs"],
  [/по месту/i, "local"],
  [/с карьера/i, "pit"],
  [/перевозка общая|не детализирован/i, "total"],
];

function parseCsvLine(line) {
  // простые кавычки только вокруг последнего поля примечания
  const out = [];
  let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const rows = [];
const lines = readFileSync(CSV_PATH, "utf8").split(/\r?\n/).filter((l) => l.trim());
for (const line of lines.slice(1)) {
  const [date, shift, flowText, trips, volume, status, note] = parseCsvLine(line).map((s) => s.trim());
  if (!date) continue;
  const downtime = status.startsWith("простой");
  const flow = downtime && !flowText
    ? null
    : (FLOW_BY_TEXT.find(([re]) => re.test(flowText))?.[1] ?? "total");
  let vol = volume ? Number(volume) : null;
  let noteOut = note || null;
  const tripsN = trips ? Number(trips) : null;
  if (!downtime && (vol == null || vol === 0) && tripsN) {
    vol = Math.round(tripsN * 19);
    noteOut = [noteOut, "объём оценён 19 м³/рейс (в источнике не указан)"].filter(Boolean).join("; ");
  }
  rows.push({
    org_id: ORG_ID,
    work_date: date,
    shift_type: shift === "день" ? "day" : shift === "ночь" ? "night" : null,
    flow,
    trips_count: tripsN,
    volume_m3: vol,
    day_status: downtime ? (status.includes("погода") ? "downtime_weather" : "downtime_tech") : "work",
    note: noteOut,
  });
}

const sum = rows.reduce((a, r) => a + Number(r.volume_m3 ?? 0), 0);
console.log(`Строк: ${rows.length}; объём: ${Math.round(sum)} м³; период: ${rows[0]?.work_date}..${rows[rows.length - 1]?.work_date}`);
console.log(`Оценённых объёмов (19 м³/рейс): ${rows.filter((r) => r.note?.includes("оценён")).length}; простоев: ${rows.filter((r) => r.day_status !== "work").length}`);

if (!COMMIT) {
  console.log("\nDry-run: БД не изменена. Для записи: node scripts/import-m3-history.mjs --commit");
  process.exit(0);
}

const env = {};
for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// created_by обязателен — от имени админа
const { data: users, error: ue } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
if (ue) throw new Error(ue.message);
const admin = users.users.find((u) => u.email === "wsupkz@gmail.com");
if (!admin) throw new Error("Админ не найден");

let inserted = 0, skipped = 0;
for (const r of rows) {
  const { error } = await db.from("production_facts").insert({ ...r, created_by: admin.id });
  if (error) {
    if (error.code === "23505") { skipped++; continue; } // уже есть — идемпотентность
    throw new Error(`${r.work_date} ${r.flow}: ${error.message}`);
  }
  inserted++;
}
console.log(`Записано: ${inserted}, пропущено (уже были): ${skipped}`);
