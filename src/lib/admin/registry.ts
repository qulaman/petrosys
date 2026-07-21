/**
 * Реестр справочников для универсального admin CRUD. Чистые данные —
 * импортируется и сервером, и клиентом. slug = имя таблицы.
 */
import { VEHICLE_TYPE_LABELS } from "@/lib/domain";

export type FieldType = "text" | "number" | "boolean" | "select" | "date";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[]; // для статических select
  optionsFrom?: "contractors" | "vehicles" | "contracts"; // FK-select, грузится на сервере
}

export interface ColumnDef {
  key: string;
  label: string;
  type?: FieldType;
  /** Подписи значений для колонок без поля в форме (например, source). */
  labels?: Record<string, string>;
}

export interface EntityConfig {
  slug: string; // = table
  title: string;
  singular: string;
  columns: ColumnDef[];
  fields: FieldDef[];
}

const vehicleTypeOptions = Object.entries(VEHICLE_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export const ENTITIES: Record<string, EntityConfig> = {
  contractors: {
    slug: "contractors",
    title: "Контрагенты",
    singular: "Контрагент",
    columns: [
      { key: "name", label: "Наименование" },
      { key: "counterparty_type", label: "Тип" },
      { key: "bin", label: "БИН/ИИН" },
      { key: "vat_payer", label: "НДС", type: "boolean" },
      { key: "is_active", label: "Активен", type: "boolean" },
    ],
    fields: [
      { key: "name", label: "Наименование", type: "text", required: true },
      {
        key: "counterparty_type",
        label: "Тип",
        type: "select",
        options: [
          { value: "subcontractor", label: "Субподрядчик" },
          { value: "client", label: "Заказчик" },
        ],
      },
      { key: "bin", label: "БИН/ИИН", type: "text" },
      { key: "legal_address", label: "Юридический адрес", type: "text" },
      { key: "head_name", label: "Руководитель", type: "text" },
      { key: "contact_phone", label: "Телефон", type: "text" },
      { key: "bank_name", label: "Банк", type: "text" },
      { key: "iik", label: "ИИК", type: "text" },
      { key: "bik", label: "БИК", type: "text" },
      { key: "vat_payer", label: "Плательщик НДС", type: "boolean" },
      { key: "is_active", label: "Активен", type: "boolean" },
    ],
  },

  vehicles: {
    slug: "vehicles",
    title: "Техника",
    singular: "Единица техники",
    columns: [
      { key: "reg_number", label: "Гос. номер" },
      { key: "brand", label: "Марка" },
      { key: "vehicle_type", label: "Вид" },
      { key: "accounting_type", label: "Учёт" },
      { key: "contract_id", label: "Договор", type: "boolean" },
      {
        key: "source",
        label: "Источник",
        labels: { import: "импорт", manual: "вручную", field: "с поля" },
      },
      { key: "is_active", label: "Активна", type: "boolean" },
    ],
    fields: [
      { key: "reg_number", label: "Гос. номер", type: "text", required: true },
      { key: "brand", label: "Марка", type: "text", required: true },
      { key: "vehicle_type", label: "Вид техники", type: "select", options: vehicleTypeOptions, required: true },
      {
        key: "accounting_type",
        label: "Тип учёта",
        type: "select",
        required: true,
        options: [
          { value: "hours", label: "По моточасам" },
          { value: "trips", label: "По рейсам" },
          { value: "both", label: "Часы + рейсы" },
        ],
      },
      { key: "contractor_id", label: "Подрядчик", type: "select", optionsFrom: "contractors" },
      { key: "contract_id", label: "Договор (для начислений)", type: "select", optionsFrom: "contracts" },
      { key: "fuel_norm_per_hour", label: "Норма л/час", type: "number" },
      { key: "approved_from", label: "Допуск с (Приложение №2)", type: "date" },
      { key: "approved_to", label: "Допуск по", type: "date" },
      { key: "qr_code", label: "QR-код (для наклейки)", type: "text" },
      { key: "is_active", label: "Активна", type: "boolean" },
    ],
  },

  drivers: {
    slug: "drivers",
    title: "Водители",
    singular: "Водитель",
    columns: [
      { key: "full_name", label: "ФИО" },
      { key: "iin", label: "ИИН" },
      { key: "phone", label: "Телефон" },
      { key: "is_active", label: "Активен", type: "boolean" },
    ],
    fields: [
      { key: "full_name", label: "ФИО", type: "text", required: true },
      { key: "iin", label: "ИИН", type: "text" },
      { key: "phone", label: "Телефон", type: "text" },
      { key: "contractor_id", label: "Подрядчик", type: "select", optionsFrom: "contractors" },
      { key: "contract_id", label: "Договор (Приложение №2)", type: "select", optionsFrom: "contracts" },
      { key: "approved_from", label: "Допуск с (Приложение №2)", type: "date" },
      { key: "approved_to", label: "Допуск по", type: "date" },
      { key: "is_active", label: "Активен", type: "boolean" },
    ],
  },

  fuel_cards: {
    slug: "fuel_cards",
    title: "Топливные карты",
    singular: "Карта",
    columns: [
      { key: "card_number", label: "Карта" },
      { key: "operator", label: "Оператор" },
      { key: "is_active", label: "Активна", type: "boolean" },
    ],
    fields: [
      { key: "card_number", label: "Номер / название карты", type: "text", required: true },
      { key: "operator", label: "Оператор АЗС", type: "text" },
      { key: "is_active", label: "Активна", type: "boolean" },
    ],
  },

  tankers: {
    slug: "tankers",
    title: "Бензовозы",
    singular: "Бензовоз",
    columns: [
      { key: "name", label: "Название" },
      { key: "capacity_liters", label: "Ёмкость, л" },
      { key: "is_active", label: "Активен", type: "boolean" },
    ],
    fields: [
      { key: "name", label: "Название", type: "text", required: true },
      { key: "capacity_liters", label: "Ёмкость, л", type: "number" },
      { key: "is_active", label: "Активен", type: "boolean" },
    ],
  },

  routes: {
    slug: "routes",
    title: "Маршруты",
    singular: "Маршрут",
    columns: [
      { key: "name", label: "Маршрут" },
      { key: "distance_km", label: "Плечо, км" },
      { key: "material", label: "Материал" },
      { key: "volume_m3", label: "Объём, м³" },
      { key: "is_active", label: "Активен", type: "boolean" },
    ],
    fields: [
      { key: "name", label: "Название", type: "text", required: true },
      { key: "distance_km", label: "Плечо откатки, км", type: "number" },
      { key: "material", label: "Материал", type: "text" },
      { key: "volume_m3", label: "Объём кузова/рейса, м³", type: "number" },
      { key: "is_active", label: "Активен", type: "boolean" },
    ],
  },

  work_types: {
    slug: "work_types",
    title: "Виды работ",
    singular: "Вид работ",
    columns: [
      { key: "name", label: "Наименование" },
      { key: "is_active", label: "Активен", type: "boolean" },
    ],
    fields: [
      { key: "name", label: "Наименование", type: "text", required: true },
      { key: "is_active", label: "Активен", type: "boolean" },
    ],
  },

  downtime_records: {
    slug: "downtime_records",
    title: "Простои",
    singular: "Простой",
    columns: [
      { key: "downtime_date", label: "Дата" },
      { key: "vehicle_id", label: "Машина" },
      { key: "fault_side", label: "Вина" },
      { key: "hours", label: "Часы" },
    ],
    fields: [
      { key: "vehicle_id", label: "Машина", type: "select", optionsFrom: "vehicles", required: true },
      { key: "downtime_date", label: "Дата", type: "date", required: true },
      {
        key: "fault_side",
        label: "Вина",
        type: "select",
        required: true,
        options: [
          { value: "contractor", label: "Подрядчик (не оплачивается)" },
          { value: "client", label: "Заказчик (компенсация)" },
        ],
      },
      { key: "reason", label: "Причина", type: "text", required: true },
      { key: "hours", label: "Часы", type: "number" },
    ],
  },

  penalties: {
    slug: "penalties",
    title: "Штрафы",
    singular: "Штраф",
    columns: [
      { key: "penalty_date", label: "Дата" },
      { key: "contract_id", label: "Договор" },
      { key: "amount", label: "Сумма" },
      { key: "settled_in_period", label: "Удержан в" },
    ],
    fields: [
      { key: "contract_id", label: "Договор", type: "select", optionsFrom: "contracts", required: true },
      { key: "amount", label: "Сумма, ₸", type: "number", required: true },
      { key: "reason", label: "Основание", type: "text", required: true },
      { key: "penalty_date", label: "Дата", type: "date", required: true },
      { key: "settled_in_period", label: "Удержан в периоде (необязательно)", type: "text" },
    ],
  },
};

export const ENTITY_ORDER = [
  "vehicles",
  "drivers",
  "contractors",
  "fuel_cards",
  "tankers",
  "routes",
  "work_types",
  "downtime_records",
  "penalties",
];
