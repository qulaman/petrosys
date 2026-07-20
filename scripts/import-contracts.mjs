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
  { key: "beknur", name: "ИП Бекнұр", bin: "940924450874", head: "Қуанышбаева Гүлжан Бақытжанқызы", vat: false },
  { key: "agaiyndylar", name: "ИП Ағайындылар", bin: "890520351203", head: "Утегулов Ертилес Ертаргынович", vat: true },
  { key: "daniyarov", name: "ИП Данияров", bin: "830905302148", head: "Данияров Марат Саблибекович", vat: false },
  { key: "kuzdibaev", name: "ИП Куздибаев", bin: "780228303263", head: "Куздибаев Руслан Жумабекович", vat: false },
  { key: "batys", name: "ТОО «Batys Zholdari»", bin: "260140016517", head: "Қабылқай Дархан Бекетұлы", vat: true },
  { key: "gorban", name: "ИП Горбань", bin: "730902300263", head: "Горбань Виктор Анатольевич", vat: false, bank: "АО «Kaspi Bank»", iik: "KZ73722C000044340938", bik: "CASPKZKA" },
  { key: "oryntai", name: "ТОО «Орынтай Б.Ж.»", bin: "941003351435", head: "Орынтай Бекболат Жақсыбекұлы", vat: true, bank: "АО «Банк ЦентрКредит»", iik: "KZ538562204114629319", bik: "KCJBKZKX" },
  { key: "kharchenko", name: "ИП Харченко А.В.", bin: "760703301423", head: "Харченко Алексей Валерьевич", vat: false, bank: "АО «Народный Банк Казахстана»", iik: "KZ626017121000013079", bik: "HSBKKZKX" },
  { key: "aliturlyev", name: "ИП Алитурлиев Е.Т.", bin: "760517302926", head: "Алитурлиев Ерлан Тюлибаевич", vat: false },
  // --- Этап A2: вторая партия (docs/Все договора), см. docs/contracts_registry_history.md ---
  { key: "ermanov", name: "ИП Ерманов", bin: "900730351289", vat: false },
  { key: "bereke", name: "ИП Береке", bin: "611020403446", vat: true },
  { key: "lygin", name: "ИП Лыгин", bin: "800220301021", vat: false },
  { key: "sparta", name: "ТОО SPARTA CONSTRUCTION", bin: "221140031229", vat: true },
  { key: "atlas", name: "ТОО «Атлас Авто»", bin: "110640018195", vat: true },
  { key: "sunqar", name: "ИП SUNQAR", bin: "021219551531", vat: false },
  { key: "sanzhar", name: "ИП Санжар", bin: "890103451282", head: "Шортанбаева Д.С.", vat: false },
  { key: "stamov", name: "ИП Стамов Р.Е.", bin: "821004301350", vat: false },
  { key: "mts", name: "ТОО «MTS 1999»", bin: "990440006750", vat: true },
  { key: "ermakhan", name: "ИП Ермахан", bin: "000709550975", head: "Нурбаулиев Ермахан Еркінұлы", vat: true },
  { key: "stroymontazh", name: "ТОО «СтройМонтаж-Актобе»", bin: "190940003441", vat: true },
  { key: "satoil", name: "ТОО «SAT-OIL LTD»", bin: "200640017989", vat: true },
  { key: "sagynbaev", name: "ИП Сағынбаев", bin: "021021551494", vat: false },
  { key: "nurkeldy", name: "ИП НҰРКЕЛДІ", bin: "980602351397", vat: false },
  { key: "iztleuov", name: "ИП Изтлеуов Н.К.", bin: "641004302093", vat: false },
  { key: "markabaev", name: "ИП «МАРКАБАЕВ»", bin: "860330302455", vat: true },
  { key: "kadekkyzy", name: "ИП «Қадекқызы О»", bin: "860526403514", vat: true },
  { key: "otemambetova", name: "ИП Өтемамбетова Л.О.", bin: "460608400715", vat: false },
  { key: "zhantazina", name: "ИП «Жантазина»", bin: "810505402067", vat: false },
  { key: "alikhan", name: "ИП «Алихан»", bin: "880711301075", vat: true },
  { key: "sems", name: "ТОО СпецЭнергоМонтажСтрой", bin: "060440006569", vat: true },
  // исторические (волны 1–2, все договоры истекли)
  { key: "zere", name: "ИП Зере", bin: "840425300957", head: "Нурмуханов Берик Муханбетович", vat: true },
  { key: "kabylkay", name: "ИП Қабылқай", bin: "940127350974", vat: false },
  { key: "nazartrans", name: "ИП Назар Транс Уэст", bin: "840812400789", vat: true },
  { key: "musirkepova", name: "ИП Мусиркепова", bin: "650321400670", vat: true },
  { key: "mukhadinov", name: "ИП Мухадинов", bin: "951121350301", vat: true },
  { key: "dzhumanazarov", name: "ИП Джуманазаров", bin: "890228303008", vat: true },
  { key: "zhumaniyazov", name: "ИП Жуманиязов", bin: "870209302171", vat: false },
  { key: "aidana", name: "ИП Айдана", bin: "920301401200", vat: false },
  { key: "turegaliev", name: "ИП Турегалиев", bin: "950728300878", vat: false },
  { key: "ergaliev", name: "ИП Ерғалиев", bin: "930424300940", vat: true },
  { key: "global", name: "ТОО «Глобал Сервис ЛТД»", bin: "171240009859", vat: true },
  { key: "tgr", name: "ТОО «T.G.R LTD»", bin: "051040007662", vat: true },
  { key: "alash", name: "ТОО «Алаш аманаты 888»", bin: "050240016021", vat: true },
  { key: "aistpost", name: "ИП «AISTPOST»", bin: "960308301011", vat: true },
  { key: "nurservice", name: "ТОО «НУР-СервисТранс»", bin: "241040031070", vat: true },
  { key: "kamanov", name: "ИП Каманов А.А.", bin: "930325301118", vat: true },
];

// Операторы техники из приложений ПУСТ (закреплены за машинами контрагента).
const OPERATORS = [
  { name: "Тургумбаев Серик", contractor: "mts" },
  { name: "Червинский А.С.", contractor: "sagynbaev" },
  { name: "Нұралы Н.Н.", contractor: "iztleuov" },
  { name: "Тулегенов М.Ж.", contractor: "nurkeldy" },
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
    prices: [
      { unit: "trip", price: 20900, from: "2026-03-27", note: "базовая ставка волны 27/03" },
      { unit: "trip", price: 10344.83, from: "2026-04-30", note: "допсоглашение №01 от 30.04" },
      { unit: "hour", price: 10344.83, from: "2026-04-30", note: "допсоглашение №01" },
    ],
    fuel: [{ price: 327, from: "2026-03-27" }, { price: 282, from: "2026-04-30" }] },
  { key: "kuzdibaev", contractor: "kuzdibaev", number: "27/03-03-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-07-30", active: true,
    prices: [
      { unit: "trip", price: 20900, from: "2026-03-27", note: "базовая ставка волны 27/03" },
      { unit: "trip", price: 24824, from: "2026-04-15", note: "повышенная до подсыхания дороги" },
      { unit: "trip", price: 10344.83, from: "2026-04-30", note: "допсоглашение №01 от 30.04" },
      { unit: "hour", price: 10344.83, from: "2026-04-30", note: "допсоглашение №01" },
    ],
    fuel: [{ price: 327, from: "2026-03-27" }, { price: 282, from: "2026-04-30" }] },
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
    prices: [
      { unit: "trip", price: 20900, from: "2026-04-10", note: "базовая ставка" },
      { unit: "trip", price: 24824, from: "2026-04-15", note: "повышенная до подсыхания дороги" },
      { unit: "trip", price: 12000, from: "2026-04-30", note: "допсоглашение №01 от 30.04" },
    ],
    fuel: [{ price: 327, from: "2026-04-10" }, { price: 328, from: "2026-04-30" }] },
  { key: "batys", contractor: "batys", number: "27/03-01-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-06-30", active: false,
    prices: [
      { unit: "trip", price: 20900, from: "2026-03-27", note: "базовая ставка" },
      { unit: "trip", price: 24824, from: "2026-04-15", note: "повышенная до подсыхания дороги" },
      { unit: "trip", price: 12000, from: "2026-04-30", note: "допсоглашение №01" },
    ],
    fuel: [{ price: 327, from: "2026-03-27" }, { price: 328, from: "2026-04-30" }] },
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
  { key: "aliturlyev", contractor: "aliturlyev", number: "04/05-01-ПУСТ-2026", type: "equipment", from: "2026-05-04", to: "2026-08-30", active: true,
    prices: [
      { unit: "hour", price: 14700, from: "2026-05-04", type: "grader", note: "базовая ставка; госномер в приложении не указан" },
      { unit: "hour", price: 12000, from: "2026-05-04", type: "loader", note: "госномер в приложении не указан" },
      { unit: "hour", price: 15700, from: "2026-06-19", type: "grader", note: "допсоглашение №01 от 19.06" },
    ],
    fuel: [{ price: 282, from: "2026-05-04" }] },
  // ------------------------- Этап A2: действующие -------------------------
  { key: "ermanov-per", contractor: "ermanov", number: "11/06-01-УОП-2026", type: "transportation", from: "2026-06-11", to: "2026-07-30", active: true,
    prices: [{ unit: "trip", price: 12069, from: "2026-06-11", note: "ставка по допсоглашению (дата в документе не указана); базовая 10344,83" }],
    fuel: [{ price: 291, from: "2026-06-11", note: "допсоглашение; базовая 282" }] },
  { key: "bereke", contractor: "bereke", number: "15/06-01-УОП-2026", type: "transportation", from: "2026-06-15", to: "2026-07-30", active: true,
    prices: [{ unit: "trip", price: 12000, from: "2026-06-15" }, { unit: "hour", price: 12000, from: "2026-06-15" }],
    fuel: [{ price: 328, from: "2026-06-15" }] },
  { key: "lygin", contractor: "lygin", number: "16/07-02-УОП-2026", type: "transportation", from: "2026-07-16", to: "2026-08-30", active: true,
    prices: [{ unit: "trip", price: 12069, from: "2026-07-16" }, { unit: "hour", price: 10345, from: "2026-07-16" }],
    fuel: [{ price: 291, from: "2026-07-16" }] },
  { key: "sparta", contractor: "sparta", number: "16/07-03-УОП-2026", type: "transportation", from: "2026-07-16", to: "2026-08-30", active: true,
    prices: [{ unit: "trip", price: 14000, from: "2026-07-16" }, { unit: "hour", price: 12000, from: "2026-07-16" }],
    fuel: [{ price: 337, from: "2026-07-16" }] },
  { key: "atlas", contractor: "atlas", number: "16/07-01-УОП-2026", type: "transportation", from: "2026-07-16", to: "2026-08-30", active: true,
    prices: [{ unit: "trip", price: 14000, from: "2026-07-16" }, { unit: "hour", price: 12000, from: "2026-07-16" }],
    fuel: [{ price: 337, from: "2026-07-16" }] },
  { key: "sunqar-new", contractor: "sunqar", number: "30/04-03-ПУСТ-2026", type: "equipment", from: "2026-04-30", to: "2026-08-30", active: true,
    prices: [
      { unit: "hour", price: 13000, from: "2026-04-30", type: "loader", reg: "087 AKD" },
      { unit: "hour", price: 13000, from: "2026-04-30", type: "loader", reg: "304 ALD" },
      { unit: "hour", price: 13000, from: "2026-04-30", type: "loader", reg: "902 AOD" },
      { unit: "hour", price: 13000, from: "2026-04-30", type: "loader", reg: "296 AMD" },
    ],
    fuel: [{ price: 282, from: "2026-04-30" }] },
  { key: "beknur-pust", contractor: "beknur", number: "16/05-02-ПУСТ-2026", type: "equipment", from: "2026-05-16", to: "2026-08-30", active: true,
    prices: [
      { unit: "hour", price: 12100, from: "2026-05-16", type: "loader", reg: "222 APD" },
      { unit: "hour", price: 12100, from: "2026-05-16", type: "loader", reg: "029 AOD" },
    ],
    fuel: [{ price: 282, from: "2026-05-16" }] },
  { key: "mts", contractor: "mts", number: "07/07-01-ПУСТ-2026", type: "equipment", from: "2026-07-07", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 20000, from: "2026-07-07", type: "excavator", reg: "252 ALD" }],
    fuel: [{ price: 328, from: "2026-07-07" }] },
  { key: "ermanov-pust", contractor: "ermanov", number: "22/06-01-ПУСТ-2026", type: "equipment", from: "2026-06-22", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 17240, from: "2026-06-22", type: "excavator", reg: "965 AFD" }],
    fuel: [{ price: 282, from: "2026-06-22" }] },
  { key: "ermakhan", contractor: "ermakhan", number: "13/07-01-ПУСТ-2026", type: "equipment", from: "2026-07-13", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 20000, from: "2026-07-13", type: "grader", reg: "595 AKD", note: "договор-драфт (поля «уточнить»)" }],
    fuel: [] },
  { key: "stroymontazh", contractor: "stroymontazh", number: "27/06-01-ПУСТ-2026", type: "equipment", from: "2026-06-27", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 18000, from: "2026-06-27", type: "grader", reg: "597 AND" }],
    fuel: [{ price: 328, from: "2026-06-27" }] },
  { key: "satoil", contractor: "satoil", number: "13/05-01-ПУСТ-2026", type: "equipment", from: "2026-05-13", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 14000, from: "2026-05-13", type: "roller", reg: "373 ALD", note: "в договоре противоречие с/без НДС" }],
    fuel: [{ price: 328, from: "2026-05-13" }] },
  { key: "sagynbaev", contractor: "sagynbaev", number: "30/04-03-ПУСТ-2026", type: "equipment", from: "2026-04-30", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 12100, from: "2026-04-30", type: "roller", reg: "812 ALD" }],
    fuel: [{ price: 282, from: "2026-04-30" }] },
  { key: "nurkeldy", contractor: "nurkeldy", number: "14/05-01-ПУСТ-2026", type: "equipment", from: "2026-05-14", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 8000, from: "2026-05-14", type: "water_truck", reg: "819 AJL" }],
    fuel: [{ price: 282, from: "2026-05-14" }] },
  { key: "iztleuov", contractor: "iztleuov", number: "18/05-02-ПУСТ-2026", type: "equipment", from: "2026-05-18", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 6000, from: "2026-05-18", type: "water_truck", reg: "660 NUR" }],
    fuel: [{ price: 282, from: "2026-05-18" }] },
  { key: "markabaev", contractor: "markabaev", number: "19/05-01-ПУСТ-2026", type: "equipment", from: "2026-05-19", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 17000, from: "2026-05-19", type: "dozer", note: "госномер в приложении не указан" }],
    fuel: [{ price: 328, from: "2026-05-19" }] },
  { key: "kadekkyzy", contractor: "kadekkyzy", number: "04/05-02-ПУСТ-2026", type: "equipment", from: "2026-05-04", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 17000, from: "2026-05-04", type: "dozer", note: "госномер в приложении не указан" }],
    fuel: [{ price: 328, from: "2026-05-04" }] },
  { key: "otemambetova", contractor: "otemambetova", number: "26/05-01-ПУСТ-2026", type: "equipment", from: "2026-05-26", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 14700, from: "2026-05-26", type: "grader", note: "госномер в приложении не указан" }],
    fuel: [{ price: 282, from: "2026-05-26" }] },
  { key: "zhantazina", contractor: "zhantazina", number: "30/04-02-ПУСТ-2026", type: "equipment", from: "2026-04-30", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 12100, from: "2026-04-30", type: "roller", note: "госномер в приложении не указан" }],
    fuel: [{ price: 282, from: "2026-04-30" }] },
  { key: "alikhan", contractor: "alikhan", number: "30/04-01-ПУСТ-2026", type: "equipment", from: "2026-04-30", to: "2026-08-30", active: true,
    prices: [],
    fuel: [{ price: 328, from: "2026-04-30" }] },
  { key: "sems", contractor: "sems", number: "30/04-01-ПУСТ-2026", type: "equipment", from: "2026-04-30", to: "2026-08-30", active: true,
    prices: [{ unit: "hour", price: 18000, from: "2026-04-30", type: "grader", note: "госномер в приложении не указан" }],
    fuel: [{ price: 328, from: "2026-04-30" }] },
  // посменные — договоры заведены, прайс отложен до решения по единице «смена»
  { key: "sanzhar-pust", contractor: "sanzhar", number: "20/05-01-ПУСТ-2026", type: "equipment", from: "2026-05-20", to: "2026-07-30", active: true,
    prices: [], fuel: [] },
  { key: "stamov-rent", contractor: "stamov", number: "02/03-2026-ДА", type: "equipment", from: "2026-03-02", to: "2026-07-30", active: true,
    prices: [], fuel: [] },
  // ------------------------- Этап A2: история (истёкшие) -------------------------
  { key: "sunqar-old", contractor: "sunqar", number: "06/04-01-ПУСТ-2026", type: "equipment", from: "2026-04-06", to: "2026-04-30", active: false, prices: [], fuel: [] },
  { key: "zere-feb", contractor: "zere", number: "01-02/26", type: "transportation", from: "2026-02-14", to: null, active: false, prices: [], fuel: [] },
  { key: "kabylkay-feb", contractor: "kabylkay", number: "03-02/26", type: "transportation", from: "2026-02-14", to: null, active: false, prices: [], fuel: [] },
  { key: "musirkepova-feb", contractor: "musirkepova", number: "04-02/26", type: "transportation", from: "2026-02-14", to: null, active: false, prices: [], fuel: [] },
  { key: "nazartrans-feb", contractor: "nazartrans", number: "04-02/26", type: "transportation", from: "2026-02-16", to: null, active: false, prices: [], fuel: [] },
  { key: "kuzdibaev-feb", contractor: "kuzdibaev", number: "05-02/26", type: "transportation", from: "2026-02-16", to: null, active: false, prices: [], fuel: [] },
  { key: "batys-feb", contractor: "batys", number: "06-02/26", type: "transportation", from: "2026-02-17", to: null, active: false, prices: [], fuel: [] },
  { key: "mukhadinov-feb", contractor: "mukhadinov", number: "07-02/26", type: "transportation", from: "2026-02-20", to: null, active: false, prices: [], fuel: [] },
  { key: "daniyarov-feb", contractor: "daniyarov", number: "25-02/26", type: "transportation", from: "2026-02-25", to: null, active: false, prices: [], fuel: [] },
  { key: "dzhumanazarov-feb", contractor: "dzhumanazarov", number: "27-02/26", type: "transportation", from: "2026-02-27", to: null, active: false, prices: [], fuel: [] },
  { key: "zhumaniyazov-feb", contractor: "zhumaniyazov", number: "27-02/26-1", type: "transportation", from: "2026-02-27", to: null, active: false, prices: [], fuel: [] },
  { key: "dabylkhanov-feb", contractor: "dabylkhanov", number: "02-03/26-1", type: "transportation", from: "2026-03-02", to: null, active: false, prices: [], fuel: [] },
  { key: "global-feb", contractor: "global", number: "05-03/26", type: "transportation", from: "2026-03-05", to: null, active: false, prices: [], fuel: [] },
  { key: "zere-rent", contractor: "zere", number: "14/02-2026/1-ДАТС", type: "equipment", from: "2026-02-14", to: "2026-03-31", active: false, prices: [], fuel: [] },
  { key: "kabylkay-rent", contractor: "kabylkay", number: "26/02-2026-ДАТС", type: "equipment", from: "2026-02-26", to: "2026-03-31", active: false, prices: [], fuel: [] },
  { key: "nazartrans-rent", contractor: "nazartrans", number: "14/02-2026/3-ДАТС", type: "equipment", from: "2026-02-14", to: "2026-03-31", active: false, prices: [], fuel: [] },
  { key: "sanzhar-rent", contractor: "sanzhar", number: "18/02-2026/1-ДАТС", type: "equipment", from: "2026-02-18", to: "2026-03-31", active: false, prices: [], fuel: [] },
  { key: "batys-rent", contractor: "batys", number: "17/02-2026/2-ДАТС", type: "equipment", from: "2026-02-17", to: "2026-03-31", active: false, prices: [], fuel: [] },
  { key: "kamanov-rent", contractor: "kamanov", number: "14/02-26-ДА", type: "equipment", from: "2026-02-14", to: "2026-04-30", active: false, prices: [], fuel: [] },
  { key: "zere-uop", contractor: "zere", number: "27/03-02-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 20900, from: "2026-03-27" }], fuel: [{ price: 327, from: "2026-03-27" }] },
  { key: "musirkepova-uop", contractor: "musirkepova", number: "27/03-04-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 20900, from: "2026-03-27" }], fuel: [{ price: 327, from: "2026-03-27" }] },
  { key: "global-uop", contractor: "global", number: "27/03-05-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 20900, from: "2026-03-27" }], fuel: [{ price: 327, from: "2026-03-27" }] },
  { key: "nazartrans-uop", contractor: "nazartrans", number: "27/03-06-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 20900, from: "2026-03-27" }], fuel: [{ price: 327, from: "2026-03-27" }] },
  { key: "ergaliev-uop", contractor: "ergaliev", number: "27/03-07-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 20900, from: "2026-03-27" }], fuel: [{ price: 327, from: "2026-03-27" }] },
  { key: "mukhadinov-uop", contractor: "mukhadinov", number: "27/03-08-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 20900, from: "2026-03-27" }], fuel: [{ price: 327, from: "2026-03-27" }] },
  { key: "turegaliev-uop", contractor: "turegaliev", number: "27/03-09-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 17319, from: "2026-03-27" }], fuel: [{ price: 282, from: "2026-03-27" }] },
  { key: "aidana-uop", contractor: "aidana", number: "27/03-12-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 17556, from: "2026-03-27" }], fuel: [] },
  { key: "zhumaniyazov-uop", contractor: "zhumaniyazov", number: "27/03-12-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 17556, from: "2026-03-27", note: "дубль номера с ИП Айдана — как в документах" }], fuel: [] },
  { key: "tgr-uop", contractor: "tgr", number: "27/03-13-УОП-2026", type: "transportation", from: "2026-03-27", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 20900, from: "2026-03-27", note: "дубль номера с ИП Данияров — как в документах" }], fuel: [{ price: 327, from: "2026-03-27" }] },
  { key: "alash-uop", contractor: "alash", number: "16/04-01-УОП-2026", type: "transportation", from: "2026-04-16", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 20900, from: "2026-04-16" }, { unit: "trip", price: 24824, from: "2026-04-16", note: "повышенная до подсыхания дороги" }],
    fuel: [{ price: 327, from: "2026-04-16" }] },
  { key: "aistpost-uop", contractor: "aistpost", number: "16/04-02-УОП-2026", type: "transportation", from: "2026-04-16", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 20900, from: "2026-04-16" }], fuel: [{ price: 327, from: "2026-04-16" }] },
  { key: "nurservice-uop", contractor: "nurservice", number: "18/04-01-УОП-2026", type: "transportation", from: "2026-04-18", to: "2026-04-30", active: false,
    prices: [{ unit: "trip", price: 30800, from: "2026-04-18", note: "в тексте также 20900 — уточнить" }], fuel: [{ price: 327, from: "2026-04-18" }] },
  { key: "kabylkay-pust", contractor: "kabylkay", number: "27/03-03-ПУСТ-2026", type: "equipment", from: "2026-03-27", to: "2026-04-30", active: false, prices: [], fuel: [] },
  { key: "nazartrans-pust", contractor: "nazartrans", number: "27/03-02-ПУСТ-2026", type: "equipment", from: "2026-03-27", to: "2026-04-30", active: false, prices: [], fuel: [] },
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
  // --- Этап A2 ---
  { reg: "087 AKD", brand: null, contract: "sunqar-new", type: "loader" },
  { reg: "304 ALD", brand: null, contract: "sunqar-new", type: "loader" },
  { reg: "902 AOD", brand: null, contract: "sunqar-new", type: "loader" },
  { reg: "296 AMD", brand: null, contract: "sunqar-new", type: "loader" },
  { reg: "222 APD", brand: "ZL50GN", contract: "beknur-pust", type: "loader" },
  { reg: "029 AOD", brand: "ZL50GN", contract: "beknur-pust", type: "loader" },
  { reg: "252 ALD", brand: "HITACHI ZX-300", contract: "mts", type: "excavator" },
  { reg: "965 AFD", brand: "VOLVO", contract: "ermanov-pust", type: "excavator" },
  { reg: "595 AKD", brand: "Liugong", contract: "ermakhan", type: "grader" },
  { reg: "597 AND", brand: "SANY", contract: "stroymontazh", type: "grader" },
  { reg: "373 ALD", brand: "XCMG XS202J", contract: "satoil", type: "roller" },
  { reg: "812 ALD", brand: "CHANGLIN", contract: "sagynbaev", type: "roller" },
  { reg: "819 AJL", brand: "Камаз", contract: "nurkeldy", type: "water_truck" },
  { reg: "660 NUR", brand: "Камаз", contract: "iztleuov", type: "water_truck" },
  { reg: "695 AWD", brand: null, contract: "sanzhar-pust", type: "excavator" },
  { reg: "696 AWD", brand: null, contract: "sanzhar-pust", type: "loader" },
  { reg: "563 GK", brand: "Хова", contract: "ermanov-per", type: "dump_truck" },
  { reg: "353 AHC", brand: null, contract: "bereke", type: "dump_truck" },
  { reg: "830 AJF", brand: null, contract: "lygin", type: "dump_truck" },
  { reg: "985 BD", brand: null, contract: "sparta", type: "dump_truck" },
  { reg: "249 BE", brand: null, contract: "sparta", type: "dump_truck" },
  { reg: "249 BA", brand: null, contract: "sparta", type: "dump_truck" },
  ...["408 BE", "471 BE", "472 BE", "473 BE", "475 BE", "478 BE", "479 BE", "481 BE", "482 BE", "483 BE", "485 BE", "486 BE", "487 BE", "489 BE"]
    .map((reg) => ({ reg, brand: null, contract: "atlas", type: "dump_truck" })),
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
    if (contractorId.has(c.name)) {
      // дозаполняем реквизиты у существующих (ИИН из второй партии документов)
      const upd = {};
      if (c.bin) upd.bin = c.bin;
      if (c.head) upd.head_name = c.head;
      if (Object.keys(upd).length) {
        const { error } = await db.from("contractors").update(upd).eq("id", contractorId.get(c.name));
        check(error, `contractor update ${c.name}`);
      }
      continue;
    }
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
  const { data: exContracts, error: ctErr } = await db.from("contracts").select("id, number, contractor_id").eq("org_id", ORG_ID);
  check(ctErr, "contracts select");
  // номера договоров в документах дублируются — ключ по номеру И контрагенту
  const contractIdByNumber = new Map(exContracts.map((c) => [`${c.number}|${c.contractor_id}`, c.id]));
  const contractIdByKey = new Map();
  for (const c of CONTRACTS) {
    let id = contractIdByNumber.get(`${c.number}|${byKey.get(c.contractor)}`);
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

  // --- Машины: только привязка существующих (инвариант 20.07: парк пополняется
  // ТОЛЬКО фактами работы или вручную; договорные приложения машин не порождают).
  // Создание из договоров — осознанно, флагом --create-vehicles.
  if (process.argv.includes("--create-vehicles")) {
    for (const a of newVehicles) {
      const { data, error } = await db.from("vehicles").insert({
        org_id: ORG_ID, brand: a.brand ?? "не указана", reg_number: a.reg,
        vehicle_type: a.type, accounting_type: a.type === "dump_truck" ? "trips" : "hours", is_active: true,
      }).select("id, reg_number, brand, vehicle_type, contract_id").single();
      check(error, `vehicle insert ${a.reg}`);
      vehByCanon.set(canonReg(a.reg), data);
    }
  } else if (newVehicles.length) {
    console.log(`Машины из договоров НЕ созданы (${newVehicles.length}) — парк только из фактов работы (--create-vehicles для отмены).`);
  }
  for (const a of VEHICLE_ASSIGN) {
    const v = vehByCanon.get(canonReg(a.reg));
    if (!v) { console.log(`Привязка пропущена: машины ${a.reg} нет в парке.`); continue; }
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

  // Операторы техники из приложений ПУСТ (создаём, если фамилия ещё не встречалась)
  let opsAdded = 0;
  for (const op of OPERATORS) {
    const key = surnameKey(op.name);
    const hit = drivers.find((d) => surnameKey(d.full_name) === key);
    if (hit) {
      const { error } = await db.from("drivers").update({ contractor_id: byKey.get(op.contractor) }).eq("id", hit.id);
      check(error, `operator update ${op.name}`);
    } else {
      const { error } = await db.from("drivers").insert({
        org_id: ORG_ID, full_name: op.name, contractor_id: byKey.get(op.contractor), is_active: true,
      });
      check(error, `operator insert ${op.name}`);
      opsAdded++;
    }
  }
  console.log(`Операторы ПУСТ: +${opsAdded} новых из ${OPERATORS.length}.`);

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
