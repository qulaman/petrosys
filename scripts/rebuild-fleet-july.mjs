// Пересборка парка по решению заказчика 20.07.2026: в системе остаются ТОЛЬКО
// машины, реально работавшие в июле (из docs/Июль_16.07.26_4 для Алмаса.xlsx).
// Договорной контур (контрагенты, договоры, прайсы, цены ГСМ) не трогаем —
// он остаётся справочником для будущего расчёта АВР и машин не порождает.
//
//   node scripts/rebuild-fleet-july.mjs            — dry-run: отчёт, БД не трогаем
//   node scripts/rebuild-fleet-july.mjs --commit   — вайп + пересборка
//
// Конвейер: разбор файла → резолв номеров (пул: файл + БД) → keep-набор машин
// по фактам → снапшот удаляемых (JSON в docs) → вайп фактов → удаление машин
// вне набора и их точечных цен → чистка водителей → загрузка фактов.
// Карточки остающихся машин (марки, договоры, сроки, QR) не изменяются.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "package.json"));
const ExcelJS = require("exceljs");

const XLSX_PATH = join(here, "..", "docs", "Июль_16.07.26_4 для Алмаса.xlsx");
const SNAPSHOT_PATH = join(here, "..", "docs", "fleet_snapshot_removed_2026-07-20.json");
const ORG_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "wsupkz@gmail.com";
const COMMIT = process.argv.includes("--commit");
const PLACEHOLDER = "— не указан —";

const CONTROL = { hours: 4726.75, tankerL: 37120, cardL: 37051.95, trips: 2023 };

const CODE_TYPE = {
  B: "dozer", K: "roller", E: "excavator", P: "loader", G: "grader", V: "water_truck",
  "A-SH": "dump_truck", "A-H": "dump_truck", "A-F": "dump_truck", "A-C": "dump_truck",
  "A-S": "dump_truck", SHN: "dump_truck", KM: "other", BCH: "other",
};
const CODE_BRAND = { "A-SH": "Шахман", "A-H": "Хова", "A-F": "FAW", SHN: "Шахман" };
const BRAND_WORDS = { ШАХМАН: "Шахман", ХОВА: "Хова", FAW: "FAW", КАМАЗ: "Камаз" };

// --- нормализация (как в import-july-v4) ---
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
    if (raw > 0 && raw < 1) return { kind: "partial", digits: raw.toFixed(2).slice(2).padStart(3, "0"), letters: "" };
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
const display = (canon) => {
  const m = canon.match(/^(\d{3})([A-Z]+)$/);
  return m ? `${m[1]} ${m[2]}` : canon;
};
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
const noonUtc = (date) => `${date}T07:00:00Z`;
const normFio = (raw) => String(raw ?? "").trim().replace(/\s+/g, " ");

// ---------------------------------------------------------------------------
async function main() {
  // --- Файл ---
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
  const data = {
    shifts: sheetRows("Журнал (Час)", { date: 1, hours: 2, code: 3, reg: 4, fio: 5 }),
    tankerFuel: sheetRows("ГСМ Бензовоз", { date: 1, code: 2, reg: 3, liters: 4 }),
    cardFuel: sheetRows("ГСМ Карточка", { date: 1, fio: 2, code: 3, reg: 4, liters: 5 }),
    trips: sheetRows("Рейсы", { date: 1, reg: 2, code: 3, object: 4, count: 5 }),
  };

  // --- БД ---
  const env = {};
  for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const check = (e, ctx) => { if (e) throw new Error(`${ctx}: ${e.message}`); };
  const insertChunked = async (table, rows) => {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from(table).insert(rows.slice(i, i + 200));
      check(error, `${table} insert`);
    }
  };

  const { data: dbVehRows, error: dvErr } = await db.from("vehicles")
    .select("id, reg_number, brand, vehicle_type, accounting_type, contractor_id, contract_id, approved_from, approved_to, fuel_norm_per_hour, qr_code, is_active")
    .eq("org_id", ORG_ID);
  check(dvErr, "vehicles select");
  const dbVeh = new Map();
  for (const row of dbVehRows) {
    const n = normReg(row.reg_number);
    if (n.kind === "clean") dbVeh.set(n.canon, row);
  }

  // --- Реестр файла и резолвер (пул: файл + БД) ---
  const occAll = [...data.shifts, ...data.tankerFuel, ...data.cardFuel, ...data.trips]
    .map((r) => ({ ...r, norm: normReg(r.reg), codeStr: String(r.code).trim() }))
    .filter((o) => o.reg !== "");
  const registry = new Map();
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
    // «VOLVO» без номера — в парке единственный VOLVO (экскаватор 965 AFD,
    // подтверждён справочником АВР): резолвим по марке.
    if (String(rawReg).trim().toUpperCase() === "VOLVO") {
      const volvos = [...dbVeh.entries()].filter(([, v]) => v.brand?.toUpperCase() === "VOLVO");
      if (volvos.length === 1) return { canon: volvos[0][0] };
    }
    const n = normReg(rawReg);
    if (n.kind === "junk") return { manual: "не разобрать" };
    if (n.kind === "clean")
      return allCanons.has(n.canon) ? { canon: n.canon } : { manual: "нет в реестре" };
    let candidates = [];
    if (n.digits) candidates = byDigits.get(n.digits) ?? [];
    else if (n.letters) candidates = [...allCanons].filter((c) => c.endsWith(n.letters));
    if (candidates.length > 1 && code) {
      const codeStr = String(code).trim();
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
      manual: candidates.length === 0 ? "нет кандидата в парке"
        : `неоднозначно: ${candidates.map(display).join(" или ")}`,
    };
  };

  // водитель машины по табелю (для строк без номера и для рейсов/бензовоза)
  const fioVotes = new Map(); // canon → Map(fio → n)
  for (const r of data.shifts) {
    const fio = normFio(r.fio);
    if (!fio || String(r.reg).trim() === "") continue;
    const n = normReg(r.reg);
    if (n.kind !== "clean") continue;
    const m = fioVotes.get(n.canon) ?? new Map();
    m.set(fio, (m.get(fio) ?? 0) + 1);
    fioVotes.set(n.canon, m);
  }
  const cardVotes = new Map();
  for (const r of data.cardFuel) {
    const fio = normFio(r.fio);
    const n = normReg(r.reg);
    if (!fio || n.kind !== "clean") continue;
    const m = cardVotes.get(n.canon) ?? new Map();
    m.set(fio, (m.get(fio) ?? 0) + 1);
    cardVotes.set(n.canon, m);
  }
  const machineFio = (canon) =>
    (fioVotes.has(canon) ? majority(fioVotes.get(canon)) : null) ??
    (cardVotes.has(canon) ? majority(cardVotes.get(canon)) : null);
  const fioMachines = new Map(); // fio → Set(canon)
  for (const [canon, m] of fioVotes)
    for (const fio of m.keys()) {
      if (!fioMachines.has(fio)) fioMachines.set(fio, new Set());
      fioMachines.get(fio).add(canon);
    }

  // --- Подготовка фактов ---
  const manual = [];
  const skipRow = (r, reason) => manual.push({ ...r, reason });
  const usedCanons = new Set();

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
      const code = String(r.code).trim();
      const cands = [...(fioMachines.get(fio) ?? [])].filter((c) => !code || typeOf(c) === CODE_TYPE[code]);
      if (cands.length === 1) canon = cands[0];
      else { skipRow(r, `без номера, по ФИО "${fio}" ${cands.length ? "неоднозначно" : "не найдено"}`); continue; }
    } else { skipRow(r, "без номера и без ФИО"); continue; }
    const key = `${canon}|${date}`;
    const nth = shiftSeen.get(key) ?? 0;
    if (nth >= 2) { skipRow(r, "третья запись за день"); continue; }
    shiftSeen.set(key, nth + 1);
    usedCanons.add(canon);
    shiftRows.push({ canon, date, hours, fio, shift_type: nth === 0 ? "day" : "night" });
  }

  const fuelRows = [];
  for (const [rows, source] of [[data.tankerFuel, "tanker"], [data.cardFuel, "card"]]) {
    for (const r of rows) {
      const date = normDate(r.date);
      if (!date) { skipRow(r, `битая дата "${r.date}"`); continue; }
      const liters = Number(r.liters);
      if (!Number.isFinite(liters) || liters <= 0) { skipRow(r, `битые литры "${r.liters}"`); continue; }
      const res = resolve(r.reg, r.code);
      if (!res.canon) { skipRow(r, res.manual); continue; }
      usedCanons.add(res.canon);
      fuelRows.push({ canon: res.canon, date, liters, source, fio: normFio(r.fio) || machineFio(res.canon) });
    }
  }

  const tripRows = [];
  for (const r of data.trips) {
    const date = normDate(r.date);
    if (!date) { skipRow(r, `битая дата "${r.date}"`); continue; }
    const count = Number(r.count);
    if (!Number.isInteger(count) || count <= 0) { skipRow(r, `битое кол-во "${r.count}"`); continue; }
    const res = resolve(r.reg, r.code);
    if (!res.canon) { skipRow(r, res.manual); continue; }
    usedCanons.add(res.canon);
    tripRows.push({ canon: res.canon, date, count, fio: machineFio(res.canon) });
  }

  // --- Keep/drop машин ---
  const keepDb = dbVehRows.filter((v) => { const n = normReg(v.reg_number); return n.kind === "clean" && usedCanons.has(n.canon); });
  const dropDb = dbVehRows.filter((v) => !keepDb.includes(v));
  const newCanons = [...usedCanons].filter((c) => !dbVeh.has(c));

  // --- Водители: keep = ФИО файла + заглушка + договорные ---
  const fileFios = new Set([
    ...shiftRows.map((r) => r.fio), ...fuelRows.map((r) => r.fio), ...tripRows.map((r) => r.fio),
  ].filter(Boolean));
  const { data: dbDrivers, error: ddErr } = await db.from("drivers")
    .select("id, full_name, contractor_id, contract_id").eq("org_id", ORG_ID);
  check(ddErr, "drivers select");
  const keepDrv = dbDrivers.filter((d) => d.full_name === PLACEHOLDER || d.contractor_id || d.contract_id || fileFios.has(d.full_name));
  const dropDrv = dbDrivers.filter((d) => !keepDrv.includes(d));
  const newFios = [...fileFios].filter((f) => !dbDrivers.some((d) => d.full_name === f)).sort();

  // --- Точечные цены удаляемых машин ---
  const dropIds = new Set(dropDb.map((v) => v.id));
  const { data: plRows, error: plErr } = await db.from("price_list")
    .select("id, contract_id, vehicle_id, vehicle_type, unit, price, valid_from").eq("org_id", ORG_ID).not("vehicle_id", "is", null);
  check(plErr, "price_list select");
  const dropPl = plRows.filter((p) => dropIds.has(p.vehicle_id));

  // --- Отчёт ---
  const sum = (a, f) => a.reduce((x, y) => x + f(y), 0);
  const r2 = (x) => Math.round(x * 100) / 100;
  console.log(`Парк: в БД ${dbVehRows.length}; останется ${keepDb.length} + ${newCanons.length} новых; удаляется ${dropDb.length}`);
  console.log(`Удаляемые: ${dropDb.map((v) => v.reg_number + (v.contract_id ? "*" : "")).join(", ")}`);
  console.log(`  (* = была привязана к договору; привязка в снапшоте)`);
  console.log(`Точечных цен прайса удаляется: ${dropPl.length} (в снапшоте)`);
  console.log(`Водители: останется ${keepDrv.length}, удаляется ${dropDrv.length}, новых из файла ${newFios.length}`);
  console.log(`Табель:   ${shiftRows.length} смен, ${r2(sum(shiftRows, (r) => r.hours))} ч (контроль ${CONTROL.hours}; пропущено нулей: ${shiftHoursSkipped})`);
  console.log(`  ночных: ${shiftRows.filter((r) => r.shift_type === "night").length}; с реальным водителем: ${shiftRows.filter((r) => r.fio).length}`);
  console.log(`Бензовоз: ${fuelRows.filter((r) => r.source === "tanker").length} выдач, ${r2(sum(fuelRows.filter((r) => r.source === "tanker"), (r) => r.liters))} л (контроль ${CONTROL.tankerL})`);
  console.log(`Карта:    ${fuelRows.filter((r) => r.source === "card").length} заправок, ${r2(sum(fuelRows.filter((r) => r.source === "card"), (r) => r.liters))} л (контроль ${CONTROL.cardL})`);
  console.log(`Рейсы:    ${tripRows.length} строк → ${sum(tripRows, (r) => r.count)} рейсов (контроль ${CONTROL.trips})`);
  console.log(`\n--- Пропущенные строки (${manual.length}) ---`);
  for (const m of manual) console.log(`${m.sheet} r${m.row}: "${m.reg}" — ${m.reason}`);

  if (!COMMIT) {
    console.log("\nDry-run: БД не изменена. Для записи: node scripts/rebuild-fleet-july.mjs --commit");
    return;
  }

  // --- Снапшот ---
  writeFileSync(SNAPSHOT_PATH, JSON.stringify({
    created: "2026-07-20", reason: "Пересборка парка: только машины из файла июля",
    vehicles: dropDb, price_list: dropPl,
  }, null, 2));
  console.log(`\nСнапшот удаляемого: ${SNAPSHOT_PATH}`);

  // --- Вайп фактов ---
  const adminId = await (async () => {
    const { data: u, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    check(error, "listUsers");
    const admin = u.users.find((x) => x.email === ADMIN_EMAIL);
    if (!admin) throw new Error(`Пользователь ${ADMIN_EMAIL} не найден`);
    return admin.id;
  })();
  const factTables = [
    ["anomalies"], ["generated_documents"], ["penalties"], ["downtime_records"],
    ["trip_records"], ["trip_lineup_vehicles", "added_at"], ["trip_lineups"],
    ["shift_records"], ["shift_journals"],
    ["fuel_issues"], ["card_transactions"], ["tanker_measurements"], ["tanker_refills"],
  ];
  for (const [t, tsCol] of factTables) {
    const { error } = await db.from(t).delete().gte(tsCol ?? "created_at", "1970-01-01");
    check(error, `${t} wipe`);
  }
  console.log("Факты удалены.");

  // --- Удаление машин вне набора и их цен ---
  if (dropPl.length) {
    const { error } = await db.from("price_list").delete().in("id", dropPl.map((p) => p.id));
    check(error, "price_list delete");
  }
  if (dropDb.length) {
    const { error } = await db.from("vehicles").delete().in("id", dropDb.map((v) => v.id));
    check(error, "vehicles delete");
  }
  console.log(`Удалено машин: ${dropDb.length}, точечных цен: ${dropPl.length}`);

  // --- Новые машины из файла (если появились) ---
  for (const canon of newCanons) {
    const e = registry.get(canon);
    const brandVote = e ? majority(e.brands) : null;
    const code = e ? majority(e.codes) : null;
    const vehicle_type = brandVote ? "dump_truck" : code ? CODE_TYPE[code] ?? "other" : "other";
    const { error } = await db.from("vehicles").insert({
      org_id: ORG_ID, brand: brandVote ?? (code ? CODE_BRAND[code] : null) ?? "не указана",
      reg_number: display(canon), vehicle_type,
      accounting_type: vehicle_type === "dump_truck" ? "trips" : "hours", is_active: true,
    });
    check(error, `vehicle insert ${canon}`);
  }

  // --- Водители ---
  if (dropDrv.length) {
    const { error } = await db.from("drivers").delete().in("id", dropDrv.map((d) => d.id));
    check(error, "drivers delete");
  }
  if (newFios.length)
    await insertChunked("drivers", newFios.map((name) => ({ org_id: ORG_ID, full_name: name, is_active: true })));
  const { data: allDrivers, error: adErr } = await db.from("drivers").select("id, full_name").eq("org_id", ORG_ID);
  check(adErr, "drivers reselect");
  const driverId = new Map(allDrivers.map((d) => [d.full_name, d.id]));
  let placeholderId = driverId.get(PLACEHOLDER);
  if (!placeholderId) {
    const { data: ph, error } = await db.from("drivers")
      .insert({ org_id: ORG_ID, full_name: PLACEHOLDER, is_active: false }).select("id").single();
    check(error, "placeholder insert");
    placeholderId = ph.id;
  }
  console.log(`Водители: удалено ${dropDrv.length}, создано ${newFios.length}`);

  // --- Служебные справочники и id машин ---
  const ensureRow = async (table, matchCol, matchVal, insertRow) => {
    const { data: found, error } = await db.from(table).select("id").eq(matchCol, matchVal).eq("org_id", ORG_ID);
    check(error, `${table} select`);
    if (found.length) return found[0].id;
    const { data: ins, error: insErr } = await db.from(table).insert(insertRow).select("id").single();
    check(insErr, `${table} insert`);
    return ins.id;
  };
  const cardId = await ensureRow("fuel_cards", "card_number", "Карта ГСМ", { org_id: ORG_ID, card_number: "Карта ГСМ", operator: null, is_active: true });
  const tankerId = await ensureRow("tankers", "name", "Бензовоз", { org_id: ORG_ID, name: "Бензовоз", capacity_liters: null, is_active: true });
  const routeId = await ensureRow("routes", "name", "Не указан", { org_id: ORG_ID, name: "Не указан", is_active: true });

  const { data: vehAfter, error: vaErr } = await db.from("vehicles").select("id, reg_number").eq("org_id", ORG_ID);
  check(vaErr, "vehicles reselect");
  const vehicleId = new Map();
  for (const row of vehAfter) {
    const n = normReg(row.reg_number);
    if (n.kind === "clean") vehicleId.set(n.canon, row.id);
  }
  const drv = (fio) => (fio && driverId.get(fio)) || placeholderId;

  // --- Факты ---
  await insertChunked("shift_records", shiftRows.map((r) => ({
    org_id: ORG_ID, vehicle_id: vehicleId.get(r.canon), driver_id: drv(r.fio),
    shift_date: r.date, shift_type: r.shift_type, hours: r.hours,
    itr_id: adminId, created_at: noonUtc(r.date),
  })));
  await insertChunked("fuel_issues", fuelRows.map((r) => ({
    org_id: ORG_ID, source_type: r.source,
    fuel_card_id: r.source === "card" ? cardId : null,
    tanker_id: r.source === "tanker" ? tankerId : null,
    vehicle_id: vehicleId.get(r.canon), driver_id: drv(r.fio), liters: r.liters,
    driver_signature_url: "", issued_by: adminId, created_at: noonUtc(r.date),
  })));
  await insertChunked("trip_records", tripRows.flatMap((r) =>
    Array.from({ length: r.count }, () => ({
      org_id: ORG_ID, vehicle_id: vehicleId.get(r.canon), driver_id: drv(r.fio),
      route_id: routeId, recorded_by: adminId, source: "checker", created_at: noonUtc(r.date),
    })),
  ));

  // --- Сверка ---
  const count = async (t) => {
    const { count: n, error } = await db.from(t).select("id", { count: "exact", head: true });
    check(error, `${t} count`);
    return n;
  };
  console.log("\n--- В БД после пересборки ---");
  console.log(`vehicles=${await count("vehicles")} (план ${keepDb.length + newCanons.length}), drivers=${await count("drivers")}`);
  console.log(`shift_records=${await count("shift_records")} (план ${shiftRows.length})`);
  console.log(`fuel_issues=${await count("fuel_issues")} (план ${fuelRows.length})`);
  console.log(`trip_records=${await count("trip_records")} (план ${sum(tripRows, (r) => r.count)})`);
}

main().catch((e) => {
  console.error("Ошибка:", e.message);
  process.exit(1);
});
