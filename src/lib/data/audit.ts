import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { AUDIT_SECTIONS } from "@/lib/audit-sections";
import type { ResolvedPeriod } from "@/lib/journals/period";

/**
 * Журнал изменений: серверные фильтры и пагинация (лог растёт на тысячи строк
 * в месяц — fetchAll здесь не годится) + сборка человекочитаемых описаний.
 */

export const AUDIT_PAGE_SIZE = 50;

const TABLE_LABELS: Record<string, string> = {
  fuel_issues: "выдача топлива",
  fuel_cards: "топливная карта",
  tankers: "бензовоз",
  tanker_refills: "приход бензовоза",
  tanker_measurements: "замер бензовоза",
  contract_fuel_prices: "цена ГСМ договора",
  trip_records: "рейс",
  trip_lineups: "карточка смены рейсов",
  trip_lineup_vehicles: "вывод на линию",
  routes: "маршрут",
  shift_records: "смена табеля",
  shift_journals: "журнал смен",
  work_types: "вид работ",
  vehicles: "техника",
  drivers: "водитель",
  contractors: "контрагент",
  contracts: "договор",
  price_list: "ставка прайса",
  penalties: "штраф",
  anomalies: "аномалия",
  org_settings: "настройки детекторов",
  generated_documents: "документ",
  document_templates: "шаблон документа",
  profiles: "пользователь",
};

const FIELD_LABELS: Record<string, string> = {
  liters: "литры",
  hours: "часы",
  shift_date: "дата смены",
  shift_type: "смена",
  price: "ставка",
  price_per_liter: "цена за литр",
  valid_from: "действует с",
  amount: "сумма",
  reason: "основание",
  status: "статус",
  name: "название",
  full_name: "ФИО",
  reg_number: "госномер",
  brand: "марка",
  vehicle_type: "вид техники",
  accounting_type: "тип учёта",
  fuel_norm_per_hour: "норма л/моточас",
  approved_from: "допуск с",
  approved_to: "допуск по",
  is_active: "активность",
  roles: "роли",
  number: "номер",
  contract_type: "тип договора",
  billing_period: "период АВР",
  vat_payer: "плательщик НДС",
  odometer: "одометр",
  source_type: "источник",
  work_date: "дата",
  penalty_date: "дата штрафа",
  resolution_note: "комментарий",
  volume_m3: "объём, м³",
  distance_km: "расстояние, км",
  vehicle_id: "машина",
  driver_id: "водитель",
  route_id: "маршрут",
  contract_id: "договор",
  contractor_id: "контрагент",
  fuel_card_id: "топливная карта",
  tanker_id: "бензовоз",
  work_type_id: "вид работ",
  unit: "единица",
  measured_liters: "замер, л",
  driver_signature_url: "подпись водителя",
  itr_signature_url: "подпись мастера",
  receipt_photo_url: "фото чека",
};

// Служебные поля не показываем в диффах.
const HIDDEN_FIELDS = new Set(["id", "org_id", "created_at", "updated_at", "dedup_key", "geo_lat", "geo_lng"]);

const ACTION_LABELS: Record<string, string> = {
  insert: "создал(а)",
  update: "изменил(а)",
  delete: "удалил(а)",
};

export interface AuditFilters {
  period: ResolvedPeriod;
  section?: string | null;
  action?: string | null;
  userId?: string | null;
  page: number;
}

export interface AuditDiffField {
  label: string;
  from: string;
  to: string;
}

export interface AuditRow {
  id: number;
  at: string;
  action: string;
  actionLabel: string;
  userName: string;
  entity: string; // «смена табеля · 089 AMD 12.07»
  diff: AuditDiffField[]; // для update; для insert/delete — ключевые поля
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageCount: number;
  users: { id: string; name: string }[];
}

type Refs = Record<string, unknown>;

export async function loadAuditPage(f: AuditFilters): Promise<AuditPage> {
  const current = await getCurrentProfile();
  const orgId = current?.profile?.org_id ?? "";
  const supabase = await createClient();
  const admin = createAdminClient();

  let q = supabase
    .from("audit_log")
    .select("id, at, action, table_name, record_id, changed_cols, old_row, new_row, user_id", { count: "exact" })
    .gte("at", f.period.fromISO)
    .lt("at", f.period.toISO);
  if (f.section && AUDIT_SECTIONS[f.section]) q = q.in("table_name", AUDIT_SECTIONS[f.section].tables);
  if (f.action) q = q.eq("action", f.action);
  if (f.userId) q = q.eq("user_id", f.userId);

  const from = f.page * AUDIT_PAGE_SIZE;
  const [logRes, veh, drv, contractors, contracts, routes, profilesRes] = await Promise.all([
    q.order("at", { ascending: false }).order("id", { ascending: false }).range(from, from + AUDIT_PAGE_SIZE - 1),
    supabase.from("vehicles").select("id, reg_number"),
    supabase.from("drivers").select("id, full_name"),
    supabase.from("contractors").select("id, name"),
    supabase.from("contracts").select("id, number"),
    supabase.from("routes").select("id, name"),
    // Имена сотрудников: RLS отдаёт только свой профиль — список через admin по org_id (инвариант №3).
    admin.from("profiles").select("id, full_name").eq("org_id", orgId),
  ]);

  const names: Record<string, Map<string, string>> = {
    vehicle_id: new Map((veh.data ?? []).map((v) => [v.id, v.reg_number])),
    driver_id: new Map((drv.data ?? []).map((d) => [d.id, d.full_name])),
    contractor_id: new Map((contractors.data ?? []).map((c) => [c.id, c.name])),
    contract_id: new Map((contracts.data ?? []).map((c) => [c.id, c.number])),
    route_id: new Map((routes.data ?? []).map((r) => [r.id, r.name])),
  };
  const userNames = new Map((profilesRes.data ?? []).map((p) => [p.id, p.full_name ?? "—"]));

  const fmtVal = (field: string, v: unknown): string => {
    if (v == null || v === "") return "—";
    if (typeof v === "boolean") return v ? "да" : "нет";
    if (names[field]) return names[field].get(String(v)) ?? String(v);
    if (Array.isArray(v)) return v.join(", ");
    const s = String(v);
    // Пути к файлам и uuid не читаемы — показываем факт наличия/короткий вид.
    if (field.endsWith("_url")) return "файл";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/.test(s)) return s.slice(0, 8) + "…";
    return s.length > 60 ? s.slice(0, 57) + "…" : s;
  };

  const entityLabel = (table: string, row: Refs): string => {
    const base = TABLE_LABELS[table] ?? table;
    const reg = row.vehicle_id ? names.vehicle_id.get(String(row.vehicle_id)) : null;
    switch (table) {
      case "fuel_issues": return `${base} · ${reg ?? ""} ${row.liters ?? ""} л`.trim();
      case "trip_records": return `${base} · ${reg ?? "—"}`;
      case "shift_records": return `${base} · ${reg ?? "—"} ${row.shift_date ?? ""}`.trim();
      case "shift_journals": return `${base} · ${row.shift_date ?? ""} ${row.shift_type === "night" ? "ночь" : "день"}`.trim();
      case "trip_lineups": return `${base} · ${row.work_date ?? ""} ${row.shift_type === "night" ? "ночь" : "день"}`.trim();
      case "trip_lineup_vehicles": return `${base} · ${reg ?? "—"}`;
      case "vehicles": return `${base} · ${row.reg_number ?? ""}`;
      case "drivers": return `${base} · ${row.full_name ?? ""}`;
      case "contractors": return `${base} · ${row.name ?? ""}`;
      case "contracts": return `${base} · ${row.number ?? ""}`;
      case "price_list": return `${base} · ${row.vehicle_type ?? ""} ${row.price ?? ""} ₸`.trim();
      case "contract_fuel_prices": return `${base} · ${row.price_per_liter ?? ""} ₸/л`;
      case "penalties": return `${base} · ${row.amount ?? ""} ₸`;
      case "routes": return `${base} · ${row.name ?? ""}`;
      case "work_types": return `${base} · ${row.name ?? ""}`;
      case "fuel_cards": return `${base} · ${row.card_number ?? ""}`;
      case "anomalies": return `${base} · ${String(row.type ?? "")}`;
      case "generated_documents": return `${base} · ${row.number ?? ""}`;
      case "document_templates": return `${base} · ${row.name ?? ""}`;
      case "profiles": return `${base} · ${row.full_name ?? ""}`;
      default: return base;
    }
  };

  const rows: AuditRow[] = (logRes.data ?? []).map((l) => {
    const oldRow = (l.old_row ?? {}) as Refs;
    const newRow = (l.new_row ?? {}) as Refs;
    const mainRow = l.action === "delete" ? oldRow : newRow;

    let diff: AuditDiffField[] = [];
    if (l.action === "update") {
      diff = (l.changed_cols ?? [])
        .filter((c) => !HIDDEN_FIELDS.has(c))
        .map((c) => ({
          label: FIELD_LABELS[c] ?? c,
          from: fmtVal(c, oldRow[c]),
          to: fmtVal(c, newRow[c]),
        }));
    } else {
      // Для создания/удаления — ключевые заполненные поля записи.
      diff = Object.entries(mainRow)
        .filter(([k, v]) => !HIDDEN_FIELDS.has(k) && v != null && v !== "")
        .slice(0, 8)
        .map(([k, v]) => ({ label: FIELD_LABELS[k] ?? k, from: "", to: fmtVal(k, v) }));
    }

    return {
      id: l.id,
      at: l.at,
      action: l.action,
      actionLabel: ACTION_LABELS[l.action] ?? l.action,
      userName: l.user_id ? userNames.get(l.user_id) ?? "—" : "система",
      entity: entityLabel(l.table_name, mainRow),
      diff,
    };
  });

  const total = logRes.count ?? 0;
  return {
    rows,
    total,
    page: f.page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    users: [...userNames.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };
}
