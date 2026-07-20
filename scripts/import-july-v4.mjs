// Импорт очищенных данных июля 2026 из docs/Июль_16.07.26_4 — 4.xlsx (версия
// мастера: правые блоки листов = исправленные данные, лист «Справочник» даёт
// ФИО водителей по машинам).
//
//   node scripts/import-july-v4.mjs            — dry-run: отчёт, БД не трогаем
//   node scripts/import-july-v4.mjs --commit   — очистка фактов + запись
//
// Отличия от import-july.mjs (v3):
//   - читаем правые (исправленные) блоки «Журнал (Час)» и «ГСМ Карточка»;
//   - водители — реальные ФИО из файла и листа «Справочник», заглушка только
//     там, где ФИО нет;
//   - очистка: ТОЛЬКО таблицы фактов (все записи — по решению заказчика 20.07
//     тестовые записи после 15.07 тоже удаляются); справочники, договоры,
//     контрагенты, машины НЕ трогаем — они уже реальные;
//   - машины не пересоздаём: маппим на существующие по номеру, недостающие
//     добавляем; машины без договора, не встретившиеся в v4, деактивируем
//     (опечаточные дубли импорта v3).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "package.json"));
const ExcelJS = require("exceljs");

const XLSX_PATH = join(here, "..", "docs", "Июль_16.07.26_4 — 4.xlsx");
const ORG_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "wsupkz@gmail.com";
const COMMIT = process.argv.includes("--commit");
const PLACEHOLDER = "— не указан —";

// Контрольные суммы из сводных листов мастера (СВод Час 2 / СВод ГСМ Б / СВод ГСМ К 2 / СВод Рейс)
const CONTROL = { hours: 4726.75, tankerL: 37120, cardL: 37051.95, trips: 2024 };

// ---------------------------------------------------------------------------
// Маппинг кодов техники (как в v3)
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
  KM: "other",
  BCH: "other",
};
const CODE_BRAND = { "A-SH": "Шахман", "A-H": "Хова", "A-F": "FAW", SHN: "Шахман" };
const BRAND_WORDS = { ШАХМАН: "Шахман", ХОВА: "Хова", FAW: "FAW", КАМАЗ: "Камаз" };

// ---------------------------------------------------------------------------
// Чтение Excel (cellVal/normReg/normDate/normHours — как в v3)
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

function normReg(raw) {
  if (typeof raw === "number") {
    if (raw > 0 && raw < 1) {
      const digits = raw.toFixed(2).slice(2).padStart(3, "0");
      return { kind: "partial", digits, letters: "" };
    }
    raw = String(raw);
  }
  let s = String(raw).toUpperCase().replace(/\s+/g, "");
  s = s.replace(/[АВЕКМНОРСТУХ]/g, (ch) => CYR2LAT[ch]);
  if (!/^[A-Z0-9]+$/.test(s)) return { kind: "junk", raw: String(raw) };
  const rev = s.match(/^([A-Z]{1,3})(\d{3})$/);
  if (rev) s = rev[2] + rev[1];
  const withRegion = s.match(/^(\d{3})([A-Z]{1,3})(\d{2})$/);
  if (withRegion) s = withRegion[1] + withRegion[2];
  const clean = s.match(/^(\d{3})([A-Z]{2,3})$/);
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

function normDate(raw) {
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function normHours(raw) {
  if (typeof raw === "number") return raw;
  const s = String(raw).trim();
  const quo = s.match(/^(\d+)'(\d+)$/);
  if (quo) return Number(quo[1]) + Number(quo[2]) / 60;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const noonUtc = (date) => `${date}T07:00:00Z`; // 12:00 Актобе

const normFio = (raw) => String(raw ?? "").trim().replace(/\s+/g, " ");

async function readWorkbook() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const sheetRows = (name, cols, skipRows = 1) => {
    const out = [];
    wb.getWorksheet(name).eachRow((row, rn) => {
      if (rn <= skipRows) return;
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
    // правый (исправленный) блок табеля: 493 смены, ФИО в колонке 11
    shifts: sheetRows("Журнал (Час)", { date: 7, hours: 8, code: 9, reg: 10, fio: 11, note: 13 }),
    tankerFuel: sheetRows("ГСМ Бензовоз", { date: 1, code: 2, reg: 3, liters: 4 }),
    // правый (исправленный) блок карточки: ФИО кириллицей
    cardFuel: sheetRows("ГСМ Карточка", { date: 8, fio: 9, code: 10, reg: 11, liters: 12 }),
    trips: sheetRows("Рейсы", { date: 1, reg: 2, code: 3, object: 4, count: 5 }),
    // лист «Справочник», блок «Журнал»: машина → ФИО → код техники
    directory: sheetRows("Справочник", { reg: 1, fio: 2, code: 3 }, 3),
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

// Очистка фактов: ВСЕ записи (решение заказчика 20.07 — тестовые записи после
// 15.07 тоже удаляем). Справочники и договоры не трогаем.
async function wipeFacts(db) {
  const factTables = [
    "anomalies", "generated_documents", "penalties", "downtime_records",
    "trip_records", "shift_records", "shift_journals",
    "fuel_issues", "card_transactions", "tanker_measurements", "tanker_refills",
  ];
  for (const t of factTables) {
    const { error } = await db.from(t).delete().gte("created_at", "1970-01-01");
    check(error, `${t} wipe`);
  }
  console.log("Факты удалены:", factTables.join(", "));
}

async function adminUserId(db) {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  check(error, "listUsers");
  const u = data.users.find((x) => x.email === ADMIN_EMAIL);
  if (!u) throw new Error(`Пользователь ${ADMIN_EMAIL} не найден`);
  return u.id;
}

// select-or-insert по имени (карта, бензовоз, маршрут-заглушка)
async function ensureRow(db, table, matchCol, matchVal, insertRow) {
  const { data, error } = await db.from(table).select("id").eq(matchCol, matchVal).eq("org_id", ORG_ID);
  check(error, `${table} select`);
  if (data.length) return data[0].id;
  const { data: ins, error: insErr } = await db.from(table).insert(insertRow).select("id").single();
  check(insErr, `${table} insert`);
  return ins.id;
}

// ---------------------------------------------------------------------------
// Основной конвейер
// ---------------------------------------------------------------------------
async function main() {
  const data = await readWorkbook();
  const manual = [];
  const skipRow = (r, reason) => manual.push({ ...r, reason });

  // Машины из БД участвуют в резолве номеров (664 → договорная 664 AKX и т.п.)
  const db = makeDb();
  const { data: dbVehRows, error: dvErr } = await db
    .from("vehicles").select("id, reg_number, brand, vehicle_type, contract_id, is_active").eq("org_id", ORG_ID);
  check(dvErr, "vehicles select");
  const dbVeh = new Map();
  for (const row of dbVehRows) {
    const n = normReg(row.reg_number);
    if (n.kind === "clean") dbVeh.set(n.canon, row);
  }

  // --- Справочник: canon → { fio, code } и обратный индекс ФИО → машины ---
  const dirByCanon = new Map();
  const dirByFio = new Map();
  for (const r of data.directory) {
    const n = normReg(r.reg);
    if (n.kind !== "clean") continue;
    const fio = normFio(r.fio);
    const entry = { fio: fio && fio !== "(пусто)" ? fio : null, code: String(r.code).trim() };
    dirByCanon.set(n.canon, entry);
    if (entry.fio) {
      if (!dirByFio.has(entry.fio)) dirByFio.set(entry.fio, []);
      dirByFio.get(entry.fio).push(n.canon);
    }
  }

  // --- Резолвер номеров: реестр = машины файла (правые блоки уже чистые) ---
  const occAll = [
    ...data.shifts, ...data.tankerFuel, ...data.cardFuel, ...data.trips,
    ...data.directory,
  ]
    .map((r) => ({ ...r, norm: normReg(r.reg), codeStr: String(r.code).trim() }))
    .filter((o) => o.reg !== "");

  const registry = new Map(); // canon → { codes, brands, count }
  for (const o of occAll) {
    if (o.norm.kind !== "clean") continue;
    const e = registry.get(o.norm.canon) ?? { codes: new Map(), brands: new Map(), count: 0 };
    e.count++;
    if (o.codeStr) {
      const brandWord = BRAND_WORDS[o.codeStr.toUpperCase().replace(/\s+/g, "")];
      if (brandWord) e.brands.set(brandWord, (e.brands.get(brandWord) ?? 0) + 1);
      else e.codes.set(o.codeStr, (e.codes.get(o.codeStr) ?? 0) + 1);
    }
    registry.set(o.norm.canon, e);
  }

  const majority = (map) => {
    let best = null, bestN = 0;
    for (const [k, n] of map) if (n > bestN) { best = k; bestN = n; }
    return best;
  };
  const typeOf = (canon) => {
    const e = registry.get(canon);
    if (e) {
      const brandVote = majority(e.brands);
      const code = majority(e.codes);
      return brandVote ? "dump_truck" : code ? CODE_TYPE[code] ?? "other" : "other";
    }
    return dbVeh.get(canon)?.vehicle_type ?? null;
  };
  const brandOf = (canon) => {
    const e = registry.get(canon);
    if (e) {
      const brandVote = majority(e.brands);
      if (brandVote) return brandVote;
      const code = majority(e.codes);
      if (code && CODE_BRAND[code]) return CODE_BRAND[code];
    }
    return dbVeh.get(canon)?.brand ?? null;
  };

  const allCanons = new Set([...registry.keys(), ...dbVeh.keys()]);
  const byDigits = new Map();
  for (const canon of allCanons) {
    const d = canon.slice(0, 3);
    if (!byDigits.has(d)) byDigits.set(d, []);
    byDigits.get(d).push(canon);
  }
  const resolve = (rawReg, code) => {
    const n = normReg(rawReg);
    if (n.kind === "junk") return { manual: "не разобрать" };
    if (n.kind === "clean")
      return allCanons.has(n.canon) ? { canon: n.canon } : { manual: "нет в реестре" };
    let candidates = [];
    if (n.digits) candidates = byDigits.get(n.digits) ?? [];
    else if (n.letters) candidates = [...allCanons].filter((c) => c.endsWith(n.letters));
    if (candidates.length > 1 && code) {
      const codeStr = String(code).trim();
      // сначала по марке (A-SH=Шахман против A-H=Хова), затем по типу
      const brand = CODE_BRAND[codeStr] ?? BRAND_WORDS[codeStr.toUpperCase()];
      if (brand) {
        const byBrand = candidates.filter((c) => brandOf(c) === brand);
        if (byBrand.length) candidates = byBrand;
      }
      if (candidates.length > 1) {
        const t = CODE_TYPE[codeStr] ?? (brand ? "dump_truck" : null);
        if (t) candidates = candidates.filter((c) => typeOf(c) === t);
      }
    }
    if (candidates.length === 1) return { canon: candidates[0] };
    return {
      manual: candidates.length === 0
        ? "нет кандидата в парке"
        : `неоднозначно: ${candidates.map(display).join(" или ")}`,
    };
  };

  // --- Табель: правый блок; без номера — резолв по ФИО через Справочник ---
  const shiftRows = [];
  const shiftSeen = new Map();
  let shiftHoursSkipped = 0;
  for (const r of data.shifts) {
    const date = normDate(r.date);
    if (!date) { skipRow(r, `битая дата "${r.date}"`); continue; }
    const hours = normHours(r.hours);
    if (hours === null || hours <= 0) { shiftHoursSkipped++; continue; }
    const fio = normFio(r.fio) || null;
    let canon = null;
    if (String(r.reg).trim() !== "") {
      const res = resolve(r.reg, r.code);
      if (!res.canon) { skipRow(r, res.manual); continue; }
      canon = res.canon;
    } else if (fio) {
      // машина не указана — ищем по ФИО в Справочнике с совпадением типа
      const code = String(r.code).trim();
      const cands = (dirByFio.get(fio) ?? []).filter(
        (c) => !code || dirByCanon.get(c)?.code === code || typeOf(c) === CODE_TYPE[code],
      );
      if (cands.length === 1) canon = cands[0];
      else { skipRow(r, `без номера, по ФИО "${fio}" ${cands.length ? "неоднозначно" : "не найдено"}`); continue; }
    } else {
      skipRow(r, "без номера и без ФИО");
      continue;
    }
    const key = `${canon}|${date}`;
    const nth = shiftSeen.get(key) ?? 0;
    if (nth >= 2) { skipRow(r, "третья запись за день"); continue; }
    shiftSeen.set(key, nth + 1);
    shiftRows.push({ canon, date, hours, fio, shift_type: nth === 0 ? "day" : "night" });
  }

  // --- ГСМ (бензовоз: без ФИО → водитель машины из Справочника; карта: ФИО в файле) ---
  const fuelRows = [];
  for (const [rows, source] of [[data.tankerFuel, "tanker"], [data.cardFuel, "card"]]) {
    for (const r of rows) {
      const date = normDate(r.date);
      if (!date) { skipRow(r, `битая дата "${r.date}"`); continue; }
      const liters = Number(r.liters);
      if (!Number.isFinite(liters) || liters <= 0) { skipRow(r, `битые литры "${r.liters}"`); continue; }
      const res = resolve(r.reg, r.code);
      if (!res.canon) { skipRow(r, res.manual); continue; }
      const fio = normFio(r.fio) || dirByCanon.get(res.canon)?.fio || null;
      fuelRows.push({ canon: res.canon, date, liters, source, fio });
    }
  }

  // --- Рейсы: водитель машины из Справочника ---
  const tripRows = [];
  for (const r of data.trips) {
    const date = normDate(r.date);
    if (!date) { skipRow(r, `битая дата "${r.date}"`); continue; }
    const count = Number(r.count);
    if (!Number.isInteger(count) || count <= 0) { skipRow(r, `битое кол-во "${r.count}"`); continue; }
    const res = resolve(r.reg, r.code);
    if (!res.canon) { skipRow(r, res.manual); continue; }
    tripRows.push({ canon: res.canon, date, count, fio: dirByCanon.get(res.canon)?.fio ?? null });
  }

  // --- Отчёт dry-run ---
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const r2 = (x) => Math.round(x * 100) / 100;
  const shiftHours = r2(sum(shiftRows, (r) => r.hours));
  const tankerL = r2(sum(fuelRows.filter((r) => r.source === "tanker"), (r) => r.liters));
  const cardL = r2(sum(fuelRows.filter((r) => r.source === "card"), (r) => r.liters));
  const tripsN = sum(tripRows, (r) => r.count);
  const fioNames = new Set([
    ...shiftRows.map((r) => r.fio), ...fuelRows.map((r) => r.fio), ...tripRows.map((r) => r.fio),
  ].filter(Boolean));
  console.log(`Машин в файле: ${registry.size}`);
  console.log(`Табель:       ${shiftRows.length} смен, ${shiftHours} ч (контроль: ${CONTROL.hours}; ремонт/нули пропущено: ${shiftHoursSkipped})`);
  console.log(`  ночных (вторая запись за день): ${shiftRows.filter((r) => r.shift_type === "night").length}`);
  console.log(`  смен с реальным водителем: ${shiftRows.filter((r) => r.fio).length} из ${shiftRows.length}`);
  console.log(`ГСМ бензовоз: ${fuelRows.filter((r) => r.source === "tanker").length} выдач, ${tankerL} л (контроль: ${CONTROL.tankerL})`);
  console.log(`ГСМ карта:    ${fuelRows.filter((r) => r.source === "card").length} заправок, ${cardL} л (контроль: ${CONTROL.cardL})`);
  console.log(`Рейсы:        ${tripRows.length} строк → ${tripsN} рейсов (контроль: ${CONTROL.trips})`);
  console.log(`Уникальных ФИО водителей: ${fioNames.size}`);
  console.log(`\n--- Пропущенные строки (${manual.length}) ---`);
  for (const m of manual) console.log(`${m.sheet} r${m.row}: "${m.reg}" — ${m.reason}`);

  if (!COMMIT) {
    console.log("\nDry-run: БД не изменена. Для записи: node scripts/import-july-v4.mjs --commit");
    return;
  }

  // --- Запись ---
  const adminId = await adminUserId(db);
  await wipeFacts(db);

  // Машины: маппинг canon → id по существующим, недостающие добавляем
  const existing = dbVehRows;
  const vehicleId = new Map();
  for (const [canon, row] of dbVeh) vehicleId.set(canon, row.id);
  const newVehicles = [...registry.entries()]
    .filter(([canon]) => !vehicleId.has(canon))
    .map(([canon, e]) => {
      const brandVote = majority(e.brands);
      const code = majority(e.codes);
      const vehicle_type = brandVote ? "dump_truck" : code ? CODE_TYPE[code] ?? "other" : "other";
      return {
        org_id: ORG_ID,
        brand: brandVote ?? (code ? CODE_BRAND[code] : null) ?? "не указана",
        reg_number: display(canon),
        vehicle_type,
        accounting_type: vehicle_type === "dump_truck" ? "trips" : "hours",
        is_active: true,
      };
    });
  await insertChunked(db, "vehicles", newVehicles);
  console.log(`Техника: +${newVehicles.length} новых (было ${existing.length}).`);
  if (newVehicles.length) {
    const { data: re, error: reErr } = await db
      .from("vehicles").select("id, reg_number").eq("org_id", ORG_ID);
    check(reErr, "vehicles reselect");
    vehicleId.clear();
    for (const row of re) {
      const n = normReg(row.reg_number);
      if (n.kind === "clean") vehicleId.set(n.canon, row.id);
    }
  }

  // Опечаточные дубли v3: без договора и не встретились в v4 → деактивируем
  const orphans = existing.filter((v) => {
    const n = normReg(v.reg_number);
    return v.is_active && !v.contract_id && (n.kind !== "clean" || !registry.has(n.canon));
  });
  if (orphans.length) {
    const { error: deErr } = await db
      .from("vehicles").update({ is_active: false }).in("id", orphans.map((v) => v.id));
    check(deErr, "vehicles deactivate");
    console.log(`Деактивировано машин без фактов и договора: ${orphans.length}: ${orphans.map((v) => v.reg_number).join(", ")}`);
  }

  // Водители: несвязанных c договорами из v3 удаляем (латиница из старой
  // карточки), реальных из v4 создаём; связанные с договорами не трогаем.
  const { data: oldDrivers, error: odErr } = await db
    .from("drivers").select("id, full_name, contractor_id, contract_id").eq("org_id", ORG_ID);
  check(odErr, "drivers select");
  const keepNames = new Map(
    oldDrivers
      .filter((d) => d.contractor_id || d.contract_id || d.full_name === PLACEHOLDER)
      .map((d) => [d.full_name, d.id]),
  );
  const dropIds = oldDrivers.filter((d) => !keepNames.has(d.full_name)).map((d) => d.id);
  if (dropIds.length) {
    const { error: ddErr } = await db.from("drivers").delete().in("id", dropIds);
    check(ddErr, "drivers delete");
  }
  let placeholderDriver = keepNames.get(PLACEHOLDER);
  if (!placeholderDriver)
    placeholderDriver = await ensureRow(db, "drivers", "full_name", PLACEHOLDER,
      { org_id: ORG_ID, full_name: PLACEHOLDER, is_active: false });
  const newNames = [...fioNames].filter((n) => !keepNames.has(n)).sort();
  await insertChunked(db, "drivers", newNames.map((name) => ({
    org_id: ORG_ID, full_name: name, is_active: true,
  })));
  const { data: allDrivers, error: adErr } = await db
    .from("drivers").select("id, full_name").eq("org_id", ORG_ID);
  check(adErr, "drivers select 2");
  const driverId = new Map(allDrivers.map((d) => [d.full_name, d.id]));
  console.log(`Водители: -${dropIds.length} старых без договора, +${newNames.length} из файла.`);

  // Карта/бензовоз/маршрут — существующие или новые
  const cardId = await ensureRow(db, "fuel_cards", "card_number", "Карта ГСМ",
    { org_id: ORG_ID, card_number: "Карта ГСМ", operator: null, is_active: true });
  const tankerId = await ensureRow(db, "tankers", "name", "Бензовоз",
    { org_id: ORG_ID, name: "Бензовоз", capacity_liters: null, is_active: true });
  const routeId = await ensureRow(db, "routes", "name", "Не указан",
    { org_id: ORG_ID, name: "Не указан", is_active: true });

  const drv = (fio) => (fio && driverId.get(fio)) || placeholderDriver;

  // Факты
  await insertChunked(db, "shift_records", shiftRows.map((r) => ({
    org_id: ORG_ID,
    vehicle_id: vehicleId.get(r.canon),
    driver_id: drv(r.fio),
    shift_date: r.date,
    shift_type: r.shift_type,
    hours: r.hours,
    itr_id: adminId,
    created_at: noonUtc(r.date),
  })));
  await insertChunked(db, "fuel_issues", fuelRows.map((r) => ({
    org_id: ORG_ID,
    source_type: r.source,
    fuel_card_id: r.source === "card" ? cardId : null,
    tanker_id: r.source === "tanker" ? tankerId : null,
    vehicle_id: vehicleId.get(r.canon),
    driver_id: drv(r.fio),
    liters: r.liters,
    driver_signature_url: "",
    issued_by: adminId,
    created_at: noonUtc(r.date),
  })));
  const tripInserts = tripRows.flatMap((r) =>
    Array.from({ length: r.count }, () => ({
      org_id: ORG_ID,
      vehicle_id: vehicleId.get(r.canon),
      driver_id: drv(r.fio),
      route_id: routeId,
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
