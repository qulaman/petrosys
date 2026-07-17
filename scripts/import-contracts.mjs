// Загрузка договоров субподрядчиков из docs/contracts (этап A плана
// docs/contracts_import_plan.md): контрагенты, договоры, effective-dated
// прайсы, цены ГСМ, привязка машин, водители Тұрнияза, дозагрузка рейсов 664 AKX.
//
//   node scripts/import-contracts.mjs            — dry-run (отчёт)
//   node scripts/import-contracts.mjs --commit   — запись (service role)
//
// Идемпотентен: контрагенты/договоры ищутся по имени/номеру, прайсы и цены ГСМ
// договора перезаписываются, машины обновляются, рейсы 664 AKX не дублируются.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
const ORG_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "wsupkz@gmail.com";
const COMMIT = process.argv.includes("--commit");

// ---------------------------------------------------------------------------
// Данные из договоров (docs/contracts_import_plan.md, раздел 1–2)
// ---------------------------------------------------------------------------
const CONTRACTORS = [
  { key: "usluga", name: "ИП Услуги Грузов", bin: "740915402596", head: "Сермагамбетова Гульмира Усеновна", vat: true, bank: "АО «Kaspi Bank»", iik: "KZ17722S000018447675", bik: "CASPKZKA" },
  { key: "turniyaz", name: "ИП Тұрнияз", bin: "950425350558", head: "Тұрнияз Абай Батыргерейұлы", vat: true },
  { key: "nazar", name: "ИП Nazar group", bin: "890304351000", head: "Шаубаев Куандык Жумамуратович", vat: true },
  { key: "yasina", name: "ИП Yasina 2020", bin: "910806400276", head: "Нурекенова Гулзар Жалгасовна", vat: true },
  { key: "dabylkhanov", name: "ИП Дабылханов", bin: "840515302417", head: "Дабылханов Сагитжан Саденович", vat: true },
  { key: "duisengaliev", name: "ИП Дуйсенгалиев", bin: "811016301374", head: "Дуйсенгалиев Дархан Берикович", vat: false },
  { key: "kuatov", name: "ИП Куатов Айбол", bin: "891209350702", head: "Куатов Айбол", vat: true },
  { key: "kokbori", name: "ИП КӨКБӨРІ", bin: "910913351474", head: "Копбасаров Ержан Сайлаубаевич", vat: false },
  // ⚠ в договоре Шернияза указан ИИН Дуйсенгалиева — оставляем как в документе, вопрос заказчику
  { key: "sherniyaz", name: "ИП Магазин «Шернияз»", bin: "811016301374", head: "Шаймердинова Гульзиза Сейлхановна", vat: false },
  { key: "miras", name: "ИП Мирас", bin: "890918351831", head: "Кистаубаев Мирас Куанышевич", vat: true },
  { key: "tama", name: "ИП Тама", bin: "941209351118", head: "Төлеуғали Шернияз Алпамысұлы", vat: false },
  { key: "beknur", name: "ИП Бекнұр", bin: null, head: "Қуанышбаева Гүлжан Бақытжанқызы", vat: false },
  { key: "agaiyndylar", name: "ИП Ағайындылар", bin: null, head: "Утегулов Ертилес Ертаргынович", vat: true },
  { key: "daniyarov", name: "ИП Данияров", bin: null, head: "Данияров Марат Саблибекович", vat: false },
  { key: "kuzdibaev", name: "ИП Куздибаев", bin: null, head: "Куздибаев Руслан Жумабекович", vat: false },
  { key: "batys", name: "ТОО «Batys Zholdari»", bin: null, head: "Қабылқай Дархан Бекетұлы", vat: true },
  { key: "gorban", name: "ИП Горбань", bin: "730902300263", head: "Горбань Виктор Анатольевич", vat: false, bank: "АО «Kaspi Bank»", iik: "KZ73722C000044340938", bik: "CASPKZKA" },
  { key: "oryntai", name: "ТОО «Орынтай Б.Ж.»", bin: "941003351435", head: "Орынтай Бекболат Жақсыбекұлы", vat: true, bank: "АО «Банк ЦентрКредит»", iik: "KZ538562204114629319", bik: "KCJBKZKX" },
  { key: "kharchenko", name: "ИП Харченко А.В.", bin: "760703301423", head: "Харченко Алексей Валерьевич", vat: false, bank: "АО «Народный Банк Казахстана»", iik: "KZ626017121000013079", bik: "HSBKKZKX" },
  { key: "aliturlyev", name: "ИП Алитурлиев Е.Т.", bin: null, head: "Алитурлиев Ерлан Тюлибаевич", vat: false },
];

// prices: { unit, price, from, type?, reg?, note? } — type по умолчанию dump_truck.
const CONTRACTS = [
  { key: "usluga-new", contractor: "usluga", number: "08/07-01-УОП-2026", type: "transportation", from: "2026-07-08", to: "2026-08-30", active: true,
    prices: [{ unit: "trip", price: 14000, from: "2026-07-08" }, { unit: "hour", price: 12000, from: "2026-07-08" }],
    fuel: [{ price: 337, from: "2026-07-08" }] },
  { key: "usluga-old", contractor: "usluga", number: "27/03-11-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-07-30", active: true,
    prices: [{ unit: "trip", price: 12000, from: "2026-03-27", note: "допсоглашение №01 от 27.03" }, { unit: "hour", price: 12000, from: "2026-03-27", note: "допсоглашение №01" }],
    fuel: [{ price: 328, from: "2026-03-27" }] },
  { key: "turniyaz-new", contractor: "turniyaz", number: "07/07-01-УОП-2026", type: "transportation", from: "2026-07-07", to: "2026-08-30", active: true,
    prices: [{ unit: "trip", price: 14000, from: "2026-07-07" }, { unit: "hour", price: 12000, from: "2026-07-07" }],
    fuel: [{ price: 337, from: "2026-07-07" }] },
  { key: "turniyaz-old", contractor: "turniyaz", number: "13/05-01-УОП-2026", type: "transportation", from: "2026-05-13", to: "2026-06-30", active: false,
    prices: [{ unit: "trip", price: 10344.83, from: "2026-05-13" }],
    fuel: [{ price: 282, from: "2026-05-13" }] },
  { key: "daniyarov", contractor: "daniyarov", number: "27/03-13-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-07-30", active: true,
    prices: [{ unit: "trip", price: 10344.83, from: "2026-04-30", note: "допсоглашение №01 от 30.04" }, { unit: "hour", price: 10344.83, from: "2026-04-30", note: "допсоглашение №01" }],
    fuel: [{ price: 282, from: "2026-04-30" }] },
  { key: "kuzdibaev", contractor: "kuzdibaev", number: "27/03-03-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-07-30", active: true,
    prices: [{ unit: "trip", price: 10344.83, from: "2026-04-30", note: "допсоглашение №01 от 30.04" }, { unit: "hour", price: 10344.83, from: "2026-04-30", note: "допсоглашение №01" }],
    fuel: [{ price: 282, from: "2026-04-30" }] },
  { key: "nazar", contractor: "nazar", number: "18/05-02-УОП-2026", type: "transportation", from: "2026-05-18", to: "2026-06-30", active: false,
    prices: [{ unit: "trip", price: 12000, from: "2026-05-18" }, { unit: "hour", price: 12000, from: "2026-05-18" }],
    fuel: [{ price: 328, from: "2026-05-18" }] },
  { key: "yasina", contractor: "yasina", number: "27/03-15-УОП-2026", type: "transportation", from: "2026-04-14", to: "2026-06-30", active: false,
    prices: [
      { unit: "trip", price: 20900, from: "2026-04-14" },
      { unit: "trip", price: 24824, from: "2026-04-15", note: "повышенная ставка до подсыхания дороги (п.3.1.1)" },
      { unit: "trip", price: 12000, from: "2026-04-30", note: "допсоглашение №01 от 30.04" },
      { unit: "hour", price: 12000, from: "2026-04-30", note: "допсоглашение №01" },
    ],
    fuel: [{ price: 327, from: "2026-04-14" }, { price: 328, from: "2026-04-30", note: "допсоглашение №01" }] },
  { key: "dabylkhanov", contractor: "dabylkhanov", number: "13/05-03-УОП-2026", type: "transportation", from: "2026-05-13", to: "2026-06-30", active: false,
    prices: [{ unit: "trip", price: 12000, from: "2026-05-13" }, { unit: "hour", price: 12000, from: "2026-05-13" }],
    fuel: [{ price: 328, from: "2026-05-13" }] },
  { key: "duisengaliev", contractor: "duisengaliev", number: "21/05-01-УОП-2026", type: "transportation", from: "2026-05-21", to: "2026-06-30", active: false,
    prices: [{ unit: "trip", price: 10344.83, from: "2026-05-21" }],
    fuel: [{ price: 282, from: "2026-05-21" }] },
  { key: "kuatov", contractor: "kuatov", number: "13/05-02-УОП-2026", type: "transportation", from: "2026-05-13", to: "2026-06-30", active: false,
    prices: [{ unit: "trip", price: 12000, from: "2026-05-13" }, { unit: "hour", price: 12000, from: "2026-05-13" }],
    fuel: [{ price: 328, from: "2026-05-13" }] },
  { key: "kokbori", contractor: "kokbori", number: "24/05-02-УОП-2026", type: "transportation", from: "2026-05-24", to: "2026-06-30", active: false,
    prices: [{ unit: "trip", price: 10344.83, from: "2026-05-24" }, { unit: "hour", price: 10344.83, from: "2026-05-24" }],
    fuel: [{ price: 282, from: "2026-05-24" }] },
  { key: "sherniyaz", contractor: "sherniyaz", number: "26/05-01-УОП-2026", type: "transportation", from: "2026-05-26", to: "2026-06-30", active: false,
    prices: [{ unit: "trip", price: 10344.83, from: "2026-05-26" }],
    fuel: [{ price: 282, from: "2026-05-26" }] },
  { key: "miras", contractor: "miras", number: "28/04-01-УОП-2026", type: "transportation", from: "2026-04-28", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 12000, from: "2026-04-28" }],
    fuel: [{ price: 328, from: "2026-04-28" }] },
  { key: "tama", contractor: "tama", number: "24/05-01-УОП-2026", type: "transportation", from: "2026-05-24", to: "2026-06-30", active: false,
    prices: [{ unit: "trip", price: 10344.83, from: "2026-05-24" }, { unit: "hour", price: 10344.83, from: "2026-05-24" }],
    fuel: [{ price: 282, from: "2026-05-24" }] },
  { key: "beknur", contractor: "beknur", number: "27/03-16-УОП-2026", type: "transportation", from: "2026-04-15", to: "2026-06-30", active: false,
    prices: [
      { unit: "trip", price: 12000, from: "2026-04-15", note: "допсоглашение №01" },
      { unit: "trip", price: 10344.83, from: "2026-04-30", note: "допсоглашение №02 от 30.04" },
      { unit: "hour", price: 10344.83, from: "2026-04-30", note: "допсоглашение №02" },
    ],
    fuel: [{ price: 328, from: "2026-04-15" }, { price: 282, from: "2026-04-30", note: "допсоглашение №02" }] },
  { key: "agaiyndylar", contractor: "agaiyndylar", number: "27/03-14-УОП-2026", type: "transportation", from: "2026-04-10", to: "2026-06-30", active: false,
    prices: [{ unit: "trip", price: 12000, from: "2026-04-30", note: "допсоглашение №01 от 30.04" }],
    fuel: [{ price: 328, from: "2026-04-30" }] },
  { key: "batys", contractor: "batys", number: "27/03-01-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-06-30", active: false,
    prices: [{ unit: "trip", price: 12000, from: "2026-04-30", note: "допсоглашение №01" }],
    fuel: [{ price: 328, from: "2026-04-30" }] },
  { key: "gorban", contractor: "gorban", number: "17/06-01-ПУСТ-2026", type: "equipment", from: "2026-06-17", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 8000, from: "2026-06-17", type: "water_truck", reg: "263 ANL" }],
    fuel: [{ price: 291, from: "2026-06-17" }] },
  { key: "oryntai", contractor: "oryntai", number: "19/05-01-ПУСТ-2026", type: "equipment", from: "2026-05-19", to: "2026-08-30", active: true,
    prices: [
      { unit: "hour", price: 17500, from: "2026-05-19", type: "dozer", reg: "413 AOD" },
      { unit: "hour", price: 17500, from: "2026-05-19", type: "dozer", reg: "412 AOD" },
    ],
    fuel: [{ price: 328, from: "2026-05-19" }] },
  { key: "kharchenko", contractor: "kharchenko", number: "18/05-01-ПУСТ-2026", type: "equipment", from: "2026-05-18", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 12100, from: "2026-05-18", type: "loader", reg: "852 AOD" }],
    fuel: [{ price: 282, from: "2026-05-18" }] },
  { key: "aliturlyev", contractor: "aliturlyev", number: "04/05-01-ПУСТ-2026", type: "equipment", from: "2026-05-04", to: null, active: true,
    prices: [{ unit: "hour", price: 15700, from: "2026-06-19", type: "grader", note: "допсоглашение №01 от 19.06; базовый договор отсутствует" }],
    fuel: [] },
];

// Приложения №2: машина → договор (+марка из договора). Только действующие
// договоры; в истёкших те же машины — вторые вхождения игнорируем.
const VEHICLE_ASSIGN = [
  // ИП Услуги Грузов 08/07 (21 самосвал)
  ...[
    ["961 AKH", "Шахман"], ["540 AKJ", "Шахман"], ["374 AHO", "FAW"], ["547 AKX", "Шахман"],
    ["190 ADB", "Шахман"], ["874 AGR", "Шахман"], ["931 AGT", "Шахман"], ["692 AIN", "FAW"],
    ["290 AFM", "Шахман"], ["798 BH", "Шахман"], ["796 BH", "Хова"], ["183 AGS", "Шахман"],
    ["967 ALF", "SITRAK"], ["248 ALI", "Хова"], ["748 GH", "Хова"], ["796 ANL", "Хова"],
    ["094 AHX", "Хова"], ["529 ALC", "Хова"], ["484 ADB", "Хова"], ["464 AIN", "Шахман"],
    ["028 AJM", "FAW"],
  ].map(([reg, brand]) => ({ reg, brand, contract: "usluga-new", type: "dump_truck" })),
  // ИП Тұрнияз 07/07 (13 самосвалов, водители в DRIVERS)
  ...[
    ["398 AKN", "Шахман"], ["543 AIJ", "Шахман"], ["943 AJG", "Хова"], ["143 ABE", "Шахман"],
    ["243 ALN", "Шахман"], ["414 BD", "Шахман"], ["011 AJI", "Хова"], ["705 FB", "Хова"],
    ["353 FJ", "Хова"], ["664 AKX", "Шахман"], ["339 AMW", "Хова"], ["898 ALC", "Шахман"],
    ["705 GH", "Хова"],
  ].map(([reg, brand]) => ({ reg, brand, contract: "turniyaz-new", type: "dump_truck" })),
  { reg: "263 ANL", brand: "Камаз", contract: "gorban", type: "water_truck" },
  { reg: "413 AOD", brand: "Т-170", contract: "oryntai", type: "dozer" },
  { reg: "412 AOD", brand: "Т-170", contract: "oryntai", type: "dozer" },
  { reg: "852 AOD", brand: null, contract: "kharchenko", type: "loader" },
];

// В БД номера 798 GH / 796 GH (из листа «Рейсы»), в договоре УГ — 798 BH / 796 BH
// (марки совпадают). Считаем одной машиной, номер оставляем договорной вариант BH.
const REG_ALIASES = { "798BH": "798GH", "796BH": "796GH" };

// Водители Тұрнияза (Приложение №2): ФИО → закреплённая машина.
const TURNIYAZ_DRIVERS = [
  ["Турнияз А.Б.", "398 AKN"], ["Асан Е.А.", "543 AIJ"], ["Абдибаев Ж.", "943 AJG"],
  ["Нугиманов Б.С.", "143 ABE"], ["Саулебаев Д.Ж.", "243 ALN"], ["Кереев Ж.", "414 BD"],
  ["Шотыбаев А.Б.", "011 AJI"], ["Жарылкагапов А.Е.", "705 FB"], ["Куандыков А.Ж.", "353 FJ"],
  ["Жолаушиев С.Е.", "664 AKX"], ["Тажимуратов М.М.", "339 AMW"], ["Тургамбаев Н.Н.", "898 ALC"],
  ["Молдашев А.", "705 GH"],
];

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------
const CYR2LAT = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X" };
function canonReg(raw) {
  let s = String(raw).toUpperCase().replace(/\s+/g, "");
  s = s.replace(/[АВЕКМНОРСТУХ]/g, (ch) => CYR2LAT[ch]);
  const withRegion = s.match(/^(\d{3})([A-Z]{1,3})(\d{2})$/);
  if (withRegion) s = withRegion[1] + withRegion[2];
  return REG_ALIASES[s] ?? s;
}

// Транслитерация фамилии (кир→лат) для матчинга с водителями из «ГСМ Карточка».
const TR = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",қ:"k",ғ:"g",ң:"n",ә:"a",ө:"o",ұ:"u",ү:"u",һ:"h",і:"i" };
function surnameKey(fullName) {
  const first = String(fullName).trim().split(/\s+/)[0].toLowerCase();
  return [...first].map((ch) => TR[ch] ?? ch).join("");
}

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
function check(error, ctx) { if (error) throw new Error(`${ctx}: ${error.message}`); }

// ---------------------------------------------------------------------------
async function main() {
  const env = loadEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: vehicles, error: vErr } = await db.from("vehicles")
    .select("id, reg_number, brand, vehicle_type, contract_id").eq("org_id", ORG_ID);
  check(vErr, "vehicles");
  const vehByCanon = new Map(vehicles.map((v) => [canonReg(v.reg_number), v]));

  const { data: drivers, error: dErr } = await db.from("drivers")
    .select("id, full_name, contractor_id").eq("org_id", ORG_ID);
  check(dErr, "drivers");

  // --- Отчёт по матчингу ---
  const newVehicles = VEHICLE_ASSIGN.filter((a) => !vehByCanon.has(canonReg(a.reg)));
  const matched = VEHICLE_ASSIGN.length - newVehicles.length;
  console.log(`Контрагентов: ${CONTRACTORS.length}, договоров: ${CONTRACTS.length}`);
  console.log(`Прайс-строк: ${CONTRACTS.reduce((a, c) => a + c.prices.length, 0)}, цен ГСМ: ${CONTRACTS.reduce((a, c) => a + c.fuel.length, 0)}`);
  console.log(`Машин в приложениях: ${VEHICLE_ASSIGN.length} — совпало с БД: ${matched}, новых: ${newVehicles.length}`);
  for (const a of newVehicles) console.log(`  новая: ${a.reg} (${a.brand ?? "?"}, ${a.type}, ${a.contract})`);

  const driverMatches = [];
  for (const [fio, reg] of TURNIYAZ_DRIVERS) {
    const key = surnameKey(fio);
    const hits = drivers.filter((d) => surnameKey(d.full_name) === key);
    driverMatches.push({ fio, reg, existing: hits.length === 1 ? hits[0] : null, ambiguous: hits.length > 1 });
  }
  console.log(`\nВодители Тұрнияза: ${TURNIYAZ_DRIVERS.length}`);
  for (const m of driverMatches)
    console.log(`  ${m.fio.padEnd(22)} ${m.reg}  → ${m.ambiguous ? "НЕОДНОЗНАЧНО, создам нового" : m.existing ? `обновлю «${m.existing.full_name}»` : "создам нового"}`);

  if (!COMMIT) {
    console.log("\nDry-run: БД не изменена. Для записи: node scripts/import-contracts.mjs --commit");
    return;
  }

  // --- Контрагенты (upsert по имени) ---
  const { data: exContractors, error: cErr } = await db.from("contractors").select("id, name").eq("org_id", ORG_ID);
  check(cErr, "contractors select");
  const contractorId = new Map(exContractors.map((c) => [c.name, c.id]));
  for (const c of CONTRACTORS) {
    if (contractorId.has(c.name)) continue;
    const { data, error } = await db.from("contractors").insert({
      org_id: ORG_ID, counterparty_type: "subcontractor", name: c.name, bin: c.bin,
      head_name: c.head, vat_payer: c.vat, bank_name: c.bank ?? null, iik: c.iik ?? null, bik: c.bik ?? null,
      is_active: true,
    }).select("id").single();
    check(error, `contractor ${c.name}`);
    contractorId.set(c.name, data.id);
  }
  const byKey = new Map(CONTRACTORS.map((c) => [c.key, contractorId.get(c.name)]));
  console.log(`Контрагенты: всего ${contractorId.size}.`);

  // --- Договоры (upsert по номеру) + прайсы/ГСМ (перезапись) ---
  const { data: exContracts, error: ctErr } = await db.from("contracts").select("id, number").eq("org_id", ORG_ID);
  check(ctErr, "contracts select");
  const contractIdByNumber = new Map(exContracts.map((c) => [c.number, c.id]));
  const contractIdByKey = new Map();
  for (const c of CONTRACTS) {
    let id = contractIdByNumber.get(c.number);
    if (!id) {
      const { data, error } = await db.from("contracts").insert({
        org_id: ORG_ID, contractor_id: byKey.get(c.contractor), number: c.number,
        contract_type: c.type, billing_period: c.type === "transportation" ? "15days" : "monthly",
        valid_from: c.from, valid_to: c.to, is_active: c.active,
      }).select("id").single();
      check(error, `contract ${c.number}`);
      id = data.id;
    } else {
      const { error } = await db.from("contracts").update({ valid_to: c.to, is_active: c.active }).eq("id", id);
      check(error, `contract update ${c.number}`);
    }
    contractIdByKey.set(c.key, id);
  }
  console.log(`Договоры: ${CONTRACTS.length}.`);

  const contractIds = [...contractIdByKey.values()];
  for (const t of ["price_list", "contract_fuel_prices"]) {
    const { error } = await db.from(t).delete().in("contract_id", contractIds);
    check(error, `${t} wipe`);
  }

  // --- Машины: новые + привязка (нужно до прайсов из-за vehicle_id override) ---
  for (const a of newVehicles) {
    const { data, error } = await db.from("vehicles").insert({
      org_id: ORG_ID, brand: a.brand ?? "не указана", reg_number: a.reg,
      vehicle_type: a.type, accounting_type: a.type === "dump_truck" ? "trips" : "hours", is_active: true,
    }).select("id, reg_number, brand, vehicle_type, contract_id").single();
    check(error, `vehicle insert ${a.reg}`);
    vehByCanon.set(canonReg(a.reg), data);
  }
  for (const a of VEHICLE_ASSIGN) {
    const v = vehByCanon.get(canonReg(a.reg));
    const contract = CONTRACTS.find((c) => c.key === a.contract);
    const upd = {
      contractor_id: byKey.get(contract.contractor),
      contract_id: contractIdByKey.get(a.contract),
      vehicle_type: a.type,
      accounting_type: a.type === "dump_truck" ? "trips" : "hours",
      approved_from: contract.from,
    };
    if (a.brand) upd.brand = a.brand;
    const { error } = await db.from("vehicles").update(upd).eq("id", v.id);
    check(error, `vehicle update ${a.reg}`);
  }
  console.log(`Машины: +${newVehicles.length} новых, привязано ${VEHICLE_ASSIGN.length}.`);

  // --- Прайсы и цены ГСМ ---
  const priceRows = [];
  const fuelRows = [];
  for (const c of CONTRACTS) {
    for (const p of c.prices) {
      priceRows.push({
        org_id: ORG_ID, contract_id: contractIdByKey.get(c.key),
        vehicle_type: p.type ?? "dump_truck", unit: p.unit, price: p.price,
        vehicle_id: p.reg ? vehByCanon.get(canonReg(p.reg)).id : null,
        valid_from: p.from, note: p.note ?? null,
      });
    }
    for (const f of c.fuel) {
      fuelRows.push({
        org_id: ORG_ID, contract_id: contractIdByKey.get(c.key),
        price_per_liter: f.price, valid_from: f.from, note: f.note ?? null,
      });
    }
  }
  { const { error } = await db.from("price_list").insert(priceRows); check(error, "price_list insert"); }
  { const { error } = await db.from("contract_fuel_prices").insert(fuelRows); check(error, "fuel prices insert"); }
  console.log(`Прайсы: ${priceRows.length} строк, цены ГСМ: ${fuelRows.length}.`);

  // --- Водители Тұрнияза ---
  const turniyazContractor = byKey.get("turniyaz");
  const turniyazContract = contractIdByKey.get("turniyaz-new");
  const driverIdByReg = new Map();
  for (const m of driverMatches) {
    let id;
    if (m.existing && !m.ambiguous) {
      const { error } = await db.from("drivers").update({
        full_name: m.fio, contractor_id: turniyazContractor, contract_id: turniyazContract,
        approved_from: "2026-07-07", is_active: true,
      }).eq("id", m.existing.id);
      check(error, `driver update ${m.fio}`);
      id = m.existing.id;
    } else {
      const { data, error } = await db.from("drivers").insert({
        org_id: ORG_ID, full_name: m.fio, contractor_id: turniyazContractor,
        contract_id: turniyazContract, approved_from: "2026-07-07", is_active: true,
      }).select("id").single();
      check(error, `driver insert ${m.fio}`);
      id = data.id;
    }
    driverIdByReg.set(canonReg(m.reg), id);
  }
  console.log(`Водители Тұрнияза: ${driverMatches.length} (обновлено ${driverMatches.filter((m) => m.existing && !m.ambiguous).length}).`);

  // --- Дозагрузка: 2 рейса 664 AKX за 12.07 (лист «Рейсы» r127, ранее пропущено) ---
  const v664 = vehByCanon.get("664AKX");
  const { count: exist664, error: tErr } = await db.from("trip_records")
    .select("id", { count: "exact", head: true }).eq("vehicle_id", v664.id);
  check(tErr, "trips 664 count");
  if (exist664 === 0) {
    const { data: route, error: rErr } = await db.from("routes").select("id").eq("name", "Не указан").single();
    check(rErr, "route");
    const { data: users, error: uErr } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    check(uErr, "listUsers");
    const admin = users.users.find((u) => u.email === ADMIN_EMAIL);
    const rows = Array.from({ length: 2 }, () => ({
      org_id: ORG_ID, vehicle_id: v664.id, driver_id: driverIdByReg.get("664AKX"),
      route_id: route.id, recorded_by: admin.id, source: "checker", created_at: "2026-07-12T07:00:00Z",
    }));
    const { error } = await db.from("trip_records").insert(rows);
    check(error, "trips 664 insert");
    console.log("Рейсы 664 AKX за 12.07: +2.");
  } else {
    console.log(`Рейсы 664 AKX уже есть (${exist664}) — пропуск.`);
  }

  // --- Сверка покрытия ---
  const { data: updVehicles, error: uvErr } = await db.from("vehicles")
    .select("id, contract_id").eq("org_id", ORG_ID);
  check(uvErr, "vehicles recheck");
  const withContract = new Set(updVehicles.filter((v) => v.contract_id).map((v) => v.id));
  const countBy = async (t) => {
    const out = [];
    for (let i = 0; ; i += 1000) {
      const { data, error } = await db.from(t).select("vehicle_id").range(i, i + 999);
      check(error, t);
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  };
  const trips = await countBy("trip_records");
  const shifts = await countBy("shift_records");
  const pct = (arr) => `${arr.filter((r) => withContract.has(r.vehicle_id)).length}/${arr.length}`;
  console.log(`\nМашин с договором: ${withContract.size}/${updVehicles.length}.`);
  console.log(`Покрытие фактов договорами: рейсы ${pct(trips)}, смены ${pct(shifts)}.`);
}

main().catch((e) => { console.error("Ошибка:", e.message); process.exit(1); });
