// Импорт реальных данных июля 2026 из docs/Июль_16.07.26_3_для_Алмаса.xlsx.
// План и правила: docs/import_july_2026_plan.md.
//
//   node scripts/import-july.mjs            — dry-run: отчёт, БД не трогаем
//   node scripts/import-july.mjs --commit   — очистка демо-данных + запись
//
// Конвейер: wipe (все факты + сидовые справочники) → техника → справочники
// (водители, карта, бензовоз, маршрут-заглушка) → факты (табель, ГСМ, рейсы).
// Повторный запуск безопасен: факты периода удаляются и грузятся заново.
//
// Решения заказчика (17.07): «объект 02/04» — хвост госномера, игнорируем;
// ремонт/простои не грузим; дубли = две смены; машины без привязки к договорам.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "package.json"));
const ExcelJS = require("exceljs");

const XLSX_PATH = join(here, "..", "docs", "Июль_16.07.26_3_для_Алмаса.xlsx");
const ORG_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "wsupkz@gmail.com";
const COMMIT = process.argv.includes("--commit");

// Сидовые демо-машины (business-rules: фиксированные UUID сидов).
const SEED_VEHICLE_IDS = [1, 2, 3, 4].map(
  (n) => `30000000-0000-0000-0000-00000000000${n}`,
);

// ---------------------------------------------------------------------------
// Маппинг кодов техники (гипотезы отмечены в плане; правится в админке)
// ---------------------------------------------------------------------------
const CODE_TYPE = {
  B: "dozer",
  K: "roller",
  E: "excavator",
  P: "loader",
  G: "grader",
  V: "water_truck",
  "A-SH": "dump_truck",
  "A-H": "dump_truck",
  "A-F": "dump_truck",
  "A-C": "dump_truck",
  "A-S": "dump_truck",
  SHN: "dump_truck",
  KM: "other", // Камаз? — уточняется
  BCH: "other", // уточняется
};
const CODE_BRAND = { "A-SH": "Шахман", "A-H": "Хова", "A-F": "FAW", SHN: "Шахман" };
const BRAND_WORDS = { ШАХМАН: "Шахман", ХОВА: "Хова", FAW: "FAW", КАМАЗ: "Камаз" };
// Точечные решения по данным: 819 AJL встречается как V (водовоз), 263 ANL —
// КАМАЗ-водовоз из договора (см. quarry-fleet-module-spec.md).
const OVERRIDES = {
  "819AJL": { vehicle_type: "water_truck", brand: "Камаз" },
  "263ANL": { vehicle_type: "water_truck", brand: "Камаз" },
};

// ---------------------------------------------------------------------------
// Чтение Excel
// ---------------------------------------------------------------------------
function cellVal(c) {
  const v = c.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.formula !== undefined) return v.result ?? "";
    if (v.text) return v.text;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return "";
  }
  return v;
}

const CYR2LAT = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X" };

// Нормализация госномера → { kind: clean|partial|junk, canon, digits, letters }.
function normReg(raw) {
  if (typeof raw === "number") {
    // "013" введённое с запятой Excel превратил в 0.13
    if (raw > 0 && raw < 1) {
      const digits = raw.toFixed(2).slice(2).padStart(3, "0");
      return { kind: "partial", digits, letters: "" };
    }
    raw = String(raw);
  }
  let s = String(raw).toUpperCase().replace(/\s+/g, "");
  s = s.replace(/[АВЕКМНОРСТУХ]/g, (ch) => CYR2LAT[ch]);
  if (!/^[A-Z0-9]+$/.test(s)) return { kind: "junk", raw: String(raw) };
  const rev = s.match(/^([A-Z]{1,3})(\d{3})$/); // AHO374 → 374AHO
  if (rev) s = rev[2] + rev[1];
  const withRegion = s.match(/^(\d{3})([A-Z]{1,3})(\d{2})$/); // 353FJ04 → 353FJ
  if (withRegion) s = withRegion[1] + withRegion[2];
  const clean = s.match(/^(\d{3})([A-Z]{2,3})$/);
  // «770 FAW» — марка на месте букв, номер фактически обрезан до цифр
  if (clean && clean[2] === "FAW") return { kind: "partial", digits: clean[1], letters: "" };
  if (clean) return { kind: "clean", canon: s, digits: clean[1], letters: clean[2] };
  if (/^\d{1,3}$/.test(s)) return { kind: "partial", digits: s.padStart(3, "0"), letters: "" };
  if (/^[A-Z]{2,3}$/.test(s)) return { kind: "partial", digits: "", letters: s };
  return { kind: "junk", raw: String(raw) };
}

function display(canon) {
  const m = canon.match(/^(\d{3})([A-Z]+)$/);
  return m ? `${m[1]} ${m[2]}` : canon;
}

// Дата: exceljs отдаёт Date (→ISO в cellVal), но есть строки вида " 03.07.2026".
function normDate(raw) {
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// Часы: 10 / 8.5 / "8'45" (=8.75) / "remont" (пропуск).
function normHours(raw) {
  if (typeof raw === "number") return raw;
  const s = String(raw).trim();
  const quo = s.match(/^(\d+)'(\d+)$/);
  if (quo) return Number(quo[1]) + Number(quo[2]) / 60;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// 12:00 по Актобе (UTC+5) — «полуденная» отметка для исторических записей.
const noonUtc = (date) => `${date}T07:00:00Z`;

async function readWorkbook() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const sheetRows = (name, cols) => {
    const out = [];
    wb.getWorksheet(name).eachRow((row, rn) => {
      if (rn === 1) return;
      const rec = { sheet: name, row: rn };
      let hasAny = false;
      for (const [key, col] of Object.entries(cols)) {
        const v = cellVal(row.getCell(col));
        rec[key] = v;
        if (v !== "") hasAny = true;
      }
      if (hasAny) out.push(rec);
    });
    return out;
  };
  return {
    shifts: sheetRows("Журнал (Час)", { date: 1, hours: 2, code: 3, reg: 4, owner: 5 }),
    tankerFuel: sheetRows("ГСМ Бензовоз", { date: 1, code: 2, reg: 3, liters: 4 }),
    cardFuel: sheetRows("ГСМ Карточка", { date: 1, driver: 2, code: 3, reg: 4, liters: 5 }),
    trips: sheetRows("Рейсы", { date: 1, reg: 2, code: 3, object: 4, count: 5 }),
  };
}

// ---------------------------------------------------------------------------
// Реестр машин (как в этапе 1) + резолвер строк к canon-номеру
// ---------------------------------------------------------------------------
function buildRegistry(occ) {
  const reg = new Map();
  for (const o of occ) {
    if (o.norm.kind !== "clean") continue;
    const e = reg.get(o.norm.canon) ?? { codes: new Map(), brands: new Map(), count: 0 };
    e.count++;
    const c = o.code;
    if (c) {
      const brandWord = BRAND_WORDS[c.toUpperCase().replace(/\s+/g, "")];
      if (brandWord) e.brands.set(brandWord, (e.brands.get(brandWord) ?? 0) + 1);
      else e.codes.set(c, (e.codes.get(c) ?? 0) + 1);
    }
    reg.set(o.norm.canon, e);
  }
  return reg;
}

function majority(map) {
  let best = null, bestN = 0;
  for (const [k, n] of map) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function resolveVehicle(canon, e) {
  const code = majority(e.codes);
  const brandVote = majority(e.brands);
  const over = OVERRIDES[canon];
  const vehicle_type = over?.vehicle_type
    ?? (brandVote ? "dump_truck" : code ? CODE_TYPE[code] ?? "other" : "other");
  const brand = over?.brand ?? brandVote ?? (code ? CODE_BRAND[code] : null) ?? "не указана";
  return {
    canon,
    reg_number: display(canon),
    brand,
    vehicle_type,
    accounting_type: vehicle_type === "dump_truck" ? "trips" : "hours",
    mentions: e.count,
  };
}

function editDist1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff <= 1;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i <= short.length; i++)
    if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  return false;
}

// Опечатки: 1–2 упоминания и буквы в ред-дистанции 1 от номера с теми же
// цифрами, встречающегося в ≥5 раз чаще (563 GR ×1 при 563 GK ×23).
function markTypos(vehicles) {
  const typos = new Map();
  for (const v of vehicles) {
    if (v.mentions > 2) continue;
    const counterpart = vehicles.find(
      (o) =>
        o !== v &&
        o.canon.slice(0, 3) === v.canon.slice(0, 3) &&
        o.mentions >= 5 * v.mentions &&
        editDist1(o.canon.slice(3), v.canon.slice(3)),
    );
    if (counterpart) typos.set(v.canon, counterpart.canon);
  }
  return typos;
}

// Резолвер одной строки файла → canon или {manual: причина}.
function makeResolver(registry, typos) {
  const byDigits = new Map();
  for (const canon of registry.keys()) {
    const d = canon.slice(0, 3);
    if (!byDigits.has(d)) byDigits.set(d, []);
    byDigits.get(d).push(canon);
  }
  const typeOf = (canon) => resolveVehicle(canon, registry.get(canon)).vehicle_type;
  const codeType = (code) =>
    CODE_TYPE[code] ?? (BRAND_WORDS[String(code).toUpperCase()] ? "dump_truck" : null);
  return (rawReg, code) => {
    const n = normReg(rawReg);
    if (n.kind === "junk") return { manual: "не разобрать" };
    if (n.kind === "clean") {
      const canon = typos.get(n.canon) ?? n.canon;
      return registry.has(canon) ? { canon } : { manual: "нет в реестре" };
    }
    let candidates = [];
    if (n.digits) candidates = byDigits.get(n.digits) ?? [];
    else if (n.letters) candidates = [...registry.keys()].filter((c) => c.endsWith(n.letters));
    if (candidates.length > 1 && code) {
      const t = codeType(String(code).trim());
      if (t) candidates = candidates.filter((c) => typeOf(c) === t);
    }
    if (candidates.length === 1) return { canon: candidates[0] };
    return {
      manual:
        candidates.length === 0
          ? "нет кандидата в парке"
          : `неоднозначно: ${candidates.map(display).join(" или ")}`,
    };
  };
}

// ---------------------------------------------------------------------------
// БД
// ---------------------------------------------------------------------------
function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function makeDb() {
  const env = loadEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function check(error, ctx) {
  if (error) throw new Error(`${ctx}: ${error.message}`);
}

async function insertChunked(db, table, rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 200));
    check(error, `${table} insert`);
  }
}

// Очистка: все факты (это тестовые записи) + сидовые демо-справочники.
async function wipeDemo(db) {
  const { error: pe } = await db
    .from("profiles")
    .update({ contractor_id: null })
    .not("contractor_id", "is", null);
  check(pe, "profiles unlink");

  const allRows = (t) => db.from(t).delete().gte("created_at", "1970-01-01");
  // Порядок — по FK: fuel_issues до card_transactions (matched_transaction_id).
  const factTables = [
    "anomalies", "generated_documents", "penalties", "downtime_records",
    "trip_records", "shift_records", "shift_journals",
    "fuel_issues", "card_transactions", "tanker_measurements", "tanker_refills",
  ];
  for (const t of factTables) {
    const { error } = await allRows(t);
    check(error, `${t} wipe`);
  }
  for (const t of ["price_list", "contract_fuel_prices", "drivers"]) {
    const { error } = await allRows(t);
    check(error, `${t} wipe`);
  }
  const { error: ve } = await db.from("vehicles").delete().in("id", SEED_VEHICLE_IDS);
  check(ve, "seed vehicles wipe");
  for (const t of ["contracts", "contractors", "fuel_cards", "tankers", "routes", "work_types"]) {
    const { error } = await allRows(t);
    check(error, `${t} wipe`);
  }
  console.log("Демо-данные удалены (факты, сидовые справочники).");
}

async function adminUserId(db) {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  check(error, "listUsers");
  const u = data.users.find((x) => x.email === ADMIN_EMAIL);
  if (!u) throw new Error(`Пользователь ${ADMIN_EMAIL} не найден`);
  return u.id;
}

// ---------------------------------------------------------------------------
// Основной конвейер
// ---------------------------------------------------------------------------
async function main() {
  const data = await readWorkbook();
  const occAll = [
    ...data.shifts.map((r) => ({ ...r, norm: normReg(r.reg), code: String(r.code).trim() })),
    ...data.tankerFuel.map((r) => ({ ...r, norm: normReg(r.reg), code: String(r.code).trim() })),
    ...data.cardFuel.map((r) => ({ ...r, norm: normReg(r.reg), code: String(r.code).trim() })),
    ...data.trips.map((r) => ({ ...r, norm: normReg(r.reg), code: String(r.code).trim() })),
  ].filter((o) => o.reg !== "");

  const registry = buildRegistry(occAll);
  let vehicles = [...registry.entries()].map(([canon, e]) => resolveVehicle(canon, e));
  const typos = markTypos(vehicles);
  vehicles = vehicles.filter((v) => !typos.has(v.canon));
  for (const canon of typos.keys()) registry.delete(canon);
  const resolve = makeResolver(registry, typos);

  // --- Факты: подготовка ---
  const manual = [];
  const skipRow = (r, reason) => manual.push({ ...r, reason });

  // Табель: пропускаем нечисловые/нулевые часы; вторая запись машины за дату — ночная смена.
  const shiftRows = [];
  const shiftSeen = new Map();
  let shiftHoursSkipped = 0;
  for (const r of data.shifts) {
    const date = normDate(r.date);
    if (!date) { skipRow(r, `битая дата "${r.date}"`); continue; }
    const hours = normHours(r.hours);
    if (hours === null || hours <= 0) { shiftHoursSkipped++; continue; } // remont / 0 / пусто
    const res = resolve(r.reg, r.code);
    if (!res.canon) { skipRow(r, res.manual); continue; }
    const key = `${res.canon}|${date}`;
    const nth = shiftSeen.get(key) ?? 0;
    if (nth >= 2) { skipRow(r, "третья запись за день"); continue; }
    shiftSeen.set(key, nth + 1);
    shiftRows.push({ canon: res.canon, date, hours, shift_type: nth === 0 ? "day" : "night" });
  }

  // ГСМ (бензовоз + карта)
  const fuelRows = [];
  const driverNames = new Set();
  for (const [rows, source] of [[data.tankerFuel, "tanker"], [data.cardFuel, "card"]]) {
    for (const r of rows) {
      const date = normDate(r.date);
      if (!date) { skipRow(r, `битая дата "${r.date}"`); continue; }
      const liters = Number(r.liters);
      if (!Number.isFinite(liters) || liters <= 0) { skipRow(r, `битые литры "${r.liters}"`); continue; }
      const res = resolve(r.reg, r.code);
      if (!res.canon) { skipRow(r, res.manual); continue; }
      const driver = String(r.driver ?? "").trim() || null;
      if (driver) driverNames.add(driver);
      fuelRows.push({ canon: res.canon, date, liters, source, driver });
    }
  }

  // Рейсы: суточный итог → N записей (дубли строк = две смены, грузим обе)
  const tripRows = [];
  for (const r of data.trips) {
    const date = normDate(r.date);
    if (!date) { skipRow(r, `битая дата "${r.date}"`); continue; }
    const count = Number(r.count);
    if (!Number.isInteger(count) || count <= 0) { skipRow(r, `битое кол-во "${r.count}"`); continue; }
    const res = resolve(r.reg, r.code);
    if (!res.canon) { skipRow(r, res.manual); continue; }
    tripRows.push({ canon: res.canon, date, count });
  }

  // --- Отчёт ---
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const shiftHours = sum(shiftRows, (r) => r.hours);
  const tankerL = sum(fuelRows.filter((r) => r.source === "tanker"), (r) => r.liters);
  const cardL = sum(fuelRows.filter((r) => r.source === "card"), (r) => r.liters);
  const tripsN = sum(tripRows, (r) => r.count);
  console.log(`Машин в реестре: ${vehicles.length} (+${typos.size} опечаток слито)`);
  console.log(`Табель:       ${shiftRows.length} смен, ${shiftHours} ч (контроль файла: 4290 ч; ремонт/нули пропущено: ${shiftHoursSkipped})`);
  console.log(`  ночных (вторая запись за день): ${shiftRows.filter((r) => r.shift_type === "night").length}`);
  console.log(`ГСМ бензовоз: ${fuelRows.filter((r) => r.source === "tanker").length} выдач, ${Math.round(tankerL * 100) / 100} л (контроль: 37120 л)`);
  console.log(`ГСМ карта:    ${fuelRows.filter((r) => r.source === "card").length} заправок, ${Math.round(cardL * 100) / 100} л (контроль: 37001.95 л)`);
  console.log(`Рейсы:        ${tripRows.length} строк → ${tripsN} рейсов (контроль: 2024)`);
  console.log(`Водителей из «ГСМ Карточка»: ${driverNames.size} (+ заглушка «— не указан —»)`);
  console.log(`\n--- Пропущенные строки (${manual.length}) ---`);
  for (const m of manual)
    console.log(`${m.sheet} r${m.row}: "${m.reg}" — ${m.reason}`);

  if (!COMMIT) {
    console.log("\nDry-run: БД не изменена. Для записи: node scripts/import-july.mjs --commit");
    return;
  }

  // --- Запись ---
  const db = makeDb();
  const adminId = await adminUserId(db);
  await wipeDemo(db);

  // Техника (после удаления сидовых 353 FJ 04 и т.п. добавятся их реальные двойники)
  const { data: existing, error: exErr } = await db
    .from("vehicles").select("id, reg_number").eq("org_id", ORG_ID);
  check(exErr, "vehicles select");
  const existingByCanon = new Map();
  for (const row of existing) {
    const n = normReg(row.reg_number);
    if (n.kind === "clean") existingByCanon.set(n.canon, row.id);
  }
  const newVehicles = vehicles.filter((v) => !existingByCanon.has(v.canon));
  await insertChunked(db, "vehicles", newVehicles.map((v) => ({
    org_id: ORG_ID,
    brand: v.brand,
    reg_number: v.reg_number,
    vehicle_type: v.vehicle_type,
    accounting_type: v.accounting_type,
    is_active: true,
  })));
  console.log(`Техника: +${newVehicles.length} новых (было ${existing.length}).`);

  const { data: allVehicles, error: avErr } = await db
    .from("vehicles").select("id, reg_number").eq("org_id", ORG_ID);
  check(avErr, "vehicles reselect");
  const vehicleId = new Map();
  for (const row of allVehicles) {
    const n = normReg(row.reg_number);
    if (n.kind === "clean") vehicleId.set(n.canon, row.id);
  }

  // Справочники
  const PLACEHOLDER = "— не указан —";
  await insertChunked(db, "drivers", [
    { org_id: ORG_ID, full_name: PLACEHOLDER, is_active: false },
    ...[...driverNames].sort().map((name) => ({ org_id: ORG_ID, full_name: name, is_active: true })),
  ]);
  const { data: allDrivers, error: adErr } = await db
    .from("drivers").select("id, full_name").eq("org_id", ORG_ID);
  check(adErr, "drivers select");
  const driverId = new Map(allDrivers.map((d) => [d.full_name, d.id]));
  const placeholderDriver = driverId.get(PLACEHOLDER);

  const { data: card, error: fcErr } = await db
    .from("fuel_cards")
    .insert({ org_id: ORG_ID, card_number: "Карта ГСМ", operator: null, is_active: true })
    .select("id").single();
  check(fcErr, "fuel_cards insert");
  const { data: tanker, error: tkErr } = await db
    .from("tankers")
    .insert({ org_id: ORG_ID, name: "Бензовоз", capacity_liters: null, is_active: true })
    .select("id").single();
  check(tkErr, "tankers insert");
  const { data: route, error: rtErr } = await db
    .from("routes")
    .insert({ org_id: ORG_ID, name: "Не указан", is_active: true })
    .select("id").single();
  check(rtErr, "routes insert");
  console.log("Справочники: водители, карта «Карта ГСМ», «Бензовоз», маршрут «Не указан».");

  // Факты
  await insertChunked(db, "shift_records", shiftRows.map((r) => ({
    org_id: ORG_ID,
    vehicle_id: vehicleId.get(r.canon),
    driver_id: placeholderDriver,
    shift_date: r.date,
    shift_type: r.shift_type,
    hours: r.hours,
    itr_id: adminId,
    created_at: noonUtc(r.date),
  })));
  await insertChunked(db, "fuel_issues", fuelRows.map((r) => ({
    org_id: ORG_ID,
    source_type: r.source,
    fuel_card_id: r.source === "card" ? card.id : null,
    tanker_id: r.source === "tanker" ? tanker.id : null,
    vehicle_id: vehicleId.get(r.canon),
    driver_id: (r.driver && driverId.get(r.driver)) || placeholderDriver,
    liters: r.liters,
    driver_signature_url: "",
    issued_by: adminId,
    created_at: noonUtc(r.date),
  })));
  const tripInserts = tripRows.flatMap((r) =>
    Array.from({ length: r.count }, () => ({
      org_id: ORG_ID,
      vehicle_id: vehicleId.get(r.canon),
      driver_id: placeholderDriver,
      route_id: route.id,
      recorded_by: adminId,
      source: "checker",
      created_at: noonUtc(r.date),
    })),
  );
  await insertChunked(db, "trip_records", tripInserts);

  // Сверка
  const count = async (t) => {
    const { count: n, error } = await db.from(t).select("id", { count: "exact", head: true });
    check(error, `${t} count`);
    return n;
  };
  console.log("\n--- В БД после импорта ---");
  console.log(`vehicles=${await count("vehicles")}, drivers=${await count("drivers")}`);
  console.log(`shift_records=${await count("shift_records")} (план ${shiftRows.length})`);
  console.log(`fuel_issues=${await count("fuel_issues")} (план ${fuelRows.length})`);
  console.log(`trip_records=${await count("trip_records")} (план ${tripInserts.length})`);
}

main().catch((e) => {
  console.error("Ошибка:", e.message);
  process.exit(1);
});
