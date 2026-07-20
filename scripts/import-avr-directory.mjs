// Обогащение парка из docs/Справочник_техники_для_АВР.xlsx (от мастера, 20.07.2026):
// марка, сроки допуска (approved_from/to из срока договора), контрагент по ИИН/БИН,
// договор по номеру, водители машин (+ перепривязка июльских смен с заглушки).
// Ставки и цены ДТ — ТОЛЬКО отчёт расхождений, деньги автоматически не правим.
//
//   node scripts/import-avr-directory.mjs            — dry-run: отчёт, БД не трогаем
//   node scripts/import-avr-directory.mjs --commit   — запись безопасных обогащений
//
// Правила безопасности: обновляем только пустые поля (brand «не указана»,
// approved_from is null, contractor_id/contract_id is null); неоднозначное —
// в отчёт. Новые машины НЕ создаём (решение заказчика по списку отдельно).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "package.json"));
const ExcelJS = require("exceljs");

const XLSX_PATH = join(here, "..", "docs", "Справочник_техники_для_АВР.xlsx");
const ORG_ID = "00000000-0000-0000-0000-000000000001";
const COMMIT = process.argv.includes("--commit");
const PLACEHOLDER = "— не указан —";

// ---------------------------------------------------------------------------
// Разбор ячеек и номеров
// ---------------------------------------------------------------------------
function cellVal(c) {
  const v = c.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.formula !== undefined) return String(v.result ?? "");
    if (v.text) return v.text;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return "";
  }
  return String(v);
}

const CYR2LAT = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X" };

// Канонизация номера, включая «паспортный» D-формат спецтехники:
// AKD013D → 013AKD, D852AOD → 852AOD, 011SM04 → 011SM (регион отрезаем).
function canon(raw) {
  let s = String(raw).toUpperCase().replace(/\s+/g, "").replace(/[АВЕКМНОРСТУХ]/g, (ch) => CYR2LAT[ch]);
  if (!/^[A-Z0-9]+$/.test(s)) return null;
  let m = s.match(/^([A-Z]{2,3})(\d{3})D$/); // AKD013D / SM011D
  if (m) s = m[2] + m[1];
  m = s.match(/^D(\d{3})([A-Z]{2,3})$/); // D852AOD
  if (m) s = m[1] + m[2];
  m = s.match(/^(\d{3})([A-Z]{1,3})(\d{2})$/); // регион-хвост 04/02
  if (m) s = m[1] + m[2];
  m = s.match(/^([A-Z]{1,3})(\d{3})$/); // AHO374 → 374AHO
  if (m) s = m[2] + m[1];
  return /^\d{3}[A-Z]{2,3}$/.test(s) ? s : null;
}

const BRAND_FROM_MODEL = [
  [/SHACMAN|SHAANXI/i, "Шахман"],
  [/HOWO/i, "Хова"],
  [/FAW/i, "FAW"],
  [/КАМАЗ/i, "Камаз"],
  [/VOLVO/i, "VOLVO"],
  [/САМС/i, "САМС"],
];
const brandFromModel = (model) => BRAND_FROM_MODEL.find(([re]) => re.test(model))?.[1] ?? null;

// «19.05–30.08.2026» / «13.05.26–30.06.26» → [from, to] в ISO
function parseTerm(raw) {
  const s = String(raw).replace(/\s+/g, "");
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{2,4})[–—-](\d{2})\.(\d{2})\.(\d{2,4})$/);
  if (m) {
    const y = (x) => (x.length === 2 ? "20" + x : x);
    return [`${y(m[3])}-${m[2]}-${m[1]}`, `${y(m[6])}-${m[5]}-${m[4]}`];
  }
  m = s.match(/^(\d{2})\.(\d{2})[–—-](\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) {
    const fromYear = Number(m[2]) > Number(m[4]) ? String(Number(m[5]) - 1) : m[5];
    return [`${fromYear}-${m[2]}-${m[1]}`, `${m[5]}-${m[4]}-${m[3]}`];
  }
  return null;
}

// «№13/05-02-УОП-2026 от 13.05.26» → «13/05-02-УОП-2026» (нормализовано)
function normContractNo(raw) {
  const s = String(raw).replace(/^№\s*/, "").split(/\s+от\s+/i)[0].trim();
  return s ? s.toUpperCase().replace(/\s+/g, "") : null;
}

const firstNumber = (raw) => {
  const m = String(raw).replace(/\s/g, "").replace(",", ".").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const normFio = (raw) => String(raw ?? "").trim().replace(/\s+/g, " ");

// ---------------------------------------------------------------------------
async function main() {
  // --- Файл ---
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet("Справочник техники");
  const rows = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const g = (c) => cellVal(row.getCell(c)).trim();
    const rec = {
      row: rn, reg: g(1), model: g(2), owner: g(3), iin: g(4), contractNo: g(5),
      rate: g(7), unit: g(8), vat: g(9), term: g(10), actual: g(11),
      driver: g(12), fuelPrice: g(13), note: g(14),
    };
    if (!rec.reg && !rec.owner) return;
    const base = rec.reg.replace(/\(.*?\)/g, " ");
    rec.canons = [...new Set(base.split("/").map((s) => canon(s)).filter(Boolean))];
    rec.iins = [...new Set((rec.iin.match(/\d{12}/g) ?? []))];
    rec.contractKey = normContractNo(rec.contractNo);
    rec.termDates = parseTerm(rec.term);
    rec.brand = brandFromModel(rec.model);
    rec.drivers = rec.driver && !/не указано|^—$|^-$/.test(rec.driver)
      ? rec.driver.split(/[,;/]| и /).map(normFio).filter(Boolean)
      : [];
    rows.push(rec);
  });

  // --- БД ---
  const env = {};
  for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const check = (e, ctx) => { if (e) throw new Error(`${ctx}: ${e.message}`); };

  const [vehR, ctrR, conR, drvR, plR, fpR] = await Promise.all([
    db.from("vehicles").select("id, reg_number, brand, vehicle_type, contractor_id, contract_id, approved_from, approved_to, is_active").eq("org_id", ORG_ID),
    db.from("contractors").select("id, name, bin").eq("org_id", ORG_ID),
    db.from("contracts").select("id, number, contractor_id").eq("org_id", ORG_ID),
    db.from("drivers").select("id, full_name").eq("org_id", ORG_ID),
    db.from("price_list").select("contract_id, vehicle_id, vehicle_type, unit, price").eq("org_id", ORG_ID),
    db.from("contract_fuel_prices").select("contract_id, price_per_liter, valid_from").eq("org_id", ORG_ID),
  ]);
  for (const [r, n] of [[vehR, "vehicles"], [ctrR, "contractors"], [conR, "contracts"], [drvR, "drivers"], [plR, "price_list"], [fpR, "fuel_prices"]]) check(r.error, n);

  const vehByCanon = new Map(vehR.data.map((v) => [canon(v.reg_number), v]).filter(([c]) => c));
  const ctrByBin = new Map(ctrR.data.filter((c) => c.bin).map((c) => [c.bin.trim(), c]));
  const conByKey = new Map();
  for (const c of conR.data) {
    const k = normContractNo(c.number);
    if (k) conByKey.set(k, [...(conByKey.get(k) ?? []), c]);
  }
  const drvByName = new Map(drvR.data.map((d) => [d.full_name, d.id]));

  // --- Матчинг и план изменений ---
  const upd = new Map(); // vehicle_id → {поля}
  const planUpd = (v, patch, why) => {
    const cur = upd.get(v.id) ?? { reg: v.reg_number, patch: {}, why: [] };
    Object.assign(cur.patch, patch);
    cur.why.push(why);
    upd.set(v.id, cur);
  };
  const report = { linked: [], moneyDiff: [], expiredWorking: [], notInDb: [], ambiguous: [], noContractInDb: [], multiRows: [] };
  const newDrivers = new Set();
  const vehicleDriver = new Map(); // vehicle_id → ФИО (единственный)

  // строки, чьи машины есть в БД; при нескольких строках на машину берём актуальную
  const rowsByVeh = new Map();
  for (const r of rows) {
    for (const c of r.canons) {
      const v = vehByCanon.get(c);
      if (v) rowsByVeh.set(v.id, [...(rowsByVeh.get(v.id) ?? []), r]);
    }
  }

  for (const [vid, vrows] of rowsByVeh) {
    const v = vehR.data.find((x) => x.id === vid);
    const actual = vrows.filter((r) => r.actual.startsWith("Да"));
    const r = actual.length === 1 ? actual[0] : vrows.length === 1 ? vrows[0] : null;
    if (!r) {
      report.multiRows.push(`${v.reg_number}: ${vrows.length} строк справочника (${vrows.map((x) => `r${x.row} ${x.actual || "?"}`).join("; ")}) — не выбрать однозначно`);
      continue;
    }

    // марка
    if (r.brand && (v.brand === "не указана" || !v.brand)) planUpd(v, { brand: r.brand }, `марка ${r.brand}`);
    // сроки допуска
    if (r.termDates && !v.approved_from)
      planUpd(v, { approved_from: r.termDates[0], approved_to: r.termDates[1] }, `допуск ${r.term}`);
    // контрагент по ИИН/БИН
    let contractor = null;
    if (r.iins.length === 1) contractor = ctrByBin.get(r.iins[0]) ?? null;
    if (contractor && !v.contractor_id) planUpd(v, { contractor_id: contractor.id }, `контрагент ${contractor.name}`);
    // договор по номеру
    if (r.contractKey && !v.contract_id) {
      const cands = (conByKey.get(r.contractKey) ?? []).filter(
        (c) => !contractor || c.contractor_id === contractor.id,
      );
      if (cands.length === 1) {
        planUpd(v, { contract_id: cands[0].id }, `договор ${cands[0].number}`);
        report.linked.push(`${v.reg_number} → ${r.contractNo} (${r.owner})`);
      } else if (r.contractNo && r.contractNo !== "—") {
        report.noContractInDb.push(`${v.reg_number}: договор «${r.contractNo}» (${r.owner}) ${cands.length ? "неоднозначен" : "не найден в БД"}`);
      }
    }
    // водитель машины
    if (r.drivers.length === 1) {
      vehicleDriver.set(vid, r.drivers[0]);
      if (!drvByName.has(r.drivers[0])) newDrivers.add(r.drivers[0]);
    } else if (r.drivers.length > 1) {
      report.ambiguous.push(`${v.reg_number}: несколько водителей (${r.drivers.join(", ")})`);
      r.drivers.forEach((d) => { if (!drvByName.has(d)) newDrivers.add(d); });
    }
    // деньги: сверка ставки и цены ДТ (отчёт)
    const contractId = v.contract_id ?? upd.get(vid)?.patch.contract_id ?? null;
    if (contractId && r.rate && r.rate !== "—") {
      const want = firstNumber(r.rate);
      const pl = plR.data.filter((p) => p.contract_id === contractId && (p.vehicle_id === vid || (!p.vehicle_id && p.vehicle_type === v.vehicle_type)));
      const have = pl.map((p) => Number(p.price));
      if (want && have.length && !have.some((h) => Math.abs(h - want) < 0.01))
        report.moneyDiff.push(`${v.reg_number}: ставка в справочнике ${r.rate} ${r.unit}, в БД ${have.join("/")}`);
      const fuelWant = firstNumber(r.fuelPrice);
      const fuel = fpR.data.filter((f) => f.contract_id === contractId).sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
      if (fuelWant && fuel && Math.abs(Number(fuel.price_per_liter) - fuelWant) > 0.01)
        report.moneyDiff.push(`${v.reg_number}: цена ДТ ${fuelWant} тг/л, в БД ${fuel.price_per_liter}`);
    }
    // истёкший договор
    if (!r.actual.startsWith("Да") && r.actual !== "" && v.is_active)
      report.expiredWorking.push(`${v.reg_number}: «${r.actual}» (${r.owner}, ${r.contractNo || "без №"})`);
  }

  // машины справочника, которых нет в БД (с актуальным договором)
  for (const r of rows) {
    if (!r.canons.length || !r.actual.startsWith("Да")) continue;
    if (!r.canons.some((c) => vehByCanon.has(c)))
      report.notInDb.push(`${r.reg} | ${r.model} | ${r.owner}`);
  }

  // --- Отчёт ---
  const p = (title, arr) => { console.log(`\n--- ${title} (${arr.length}) ---`); arr.forEach((x) => console.log("  " + x)); };
  console.log(`Строк в справочнике: ${rows.length}; машин совпало с БД: ${rowsByVeh.size}`);
  console.log(`Обновлений машин запланировано: ${upd.size}`);
  for (const { reg, why } of upd.values()) console.log(`  ${reg}: ${why.join("; ")}`);
  console.log(`\nНовых водителей: ${newDrivers.size} (${[...newDrivers].join(", ")})`);
  console.log(`Машин с единственным водителем (для перепривязки смен с заглушки): ${vehicleDriver.size}`);
  p("Привязка договоров", report.linked);
  p("Договор в справочнике есть, в БД не найден/неоднозначен", report.noContractInDb);
  p("РАСХОЖДЕНИЯ ПО ДЕНЬГАМ (только отчёт)", report.moneyDiff);
  p("Истёкшие/сомнительные договоры у машин из БД", report.expiredWorking);
  p("Актуальный договор, машины нет в БД", report.notInDb);
  p("Неоднозначности", [...report.ambiguous, ...report.multiRows]);

  if (!COMMIT) {
    console.log("\nDry-run: БД не изменена. Для записи: node scripts/import-avr-directory.mjs --commit");
    return;
  }

  // --- Запись ---
  for (const [vid, { patch }] of upd) {
    const { error } = await db.from("vehicles").update(patch).eq("id", vid);
    check(error, `vehicle ${vid} update`);
  }
  console.log(`\nОбновлено машин: ${upd.size}`);

  if (newDrivers.size) {
    const { error } = await db.from("drivers").insert([...newDrivers].sort().map((name) => ({ org_id: ORG_ID, full_name: name, is_active: true })));
    check(error, "drivers insert");
    const { data: all } = await db.from("drivers").select("id, full_name").eq("org_id", ORG_ID);
    all.forEach((d) => drvByName.set(d.full_name, d.id));
    console.log(`Создано водителей: ${newDrivers.size}`);
  }

  // перепривязка июльских смен с заглушки на водителя машины
  const placeholderId = drvByName.get(PLACEHOLDER);
  let reassigned = 0;
  if (placeholderId) {
    for (const [vid, fio] of vehicleDriver) {
      const did = drvByName.get(fio);
      if (!did) continue;
      const { data, error } = await db.from("shift_records")
        .update({ driver_id: did })
        .eq("vehicle_id", vid).eq("driver_id", placeholderId)
        .select("id");
      check(error, "shift reassign");
      reassigned += data?.length ?? 0;
    }
  }
  console.log(`Смен перепривязано с заглушки на водителей машин: ${reassigned}`);
}

main().catch((e) => {
  console.error("Ошибка:", e.message);
  process.exit(1);
});
