import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Building2, Calculator, ClipboardX, Contact, CreditCard, FileSignature, FileType2, Fuel,
  Gavel, History, Mountain, QrCode, Route, ShieldCheck, SlidersHorizontal, Truck, Wrench,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AdminCard } from "@/components/admin/admin-card";
import { ExportDirectoriesButton } from "@/components/admin/export-directories-button";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { ENTITIES } from "@/lib/admin/registry";

export const metadata = { title: "Справочники" };

/**
 * Иконки и пояснения справочников — презентация, реестр про CRUD и ничего о ней не знает.
 * Иконки не повторяются: по ним раздел узнаётся боковым зрением.
 */
const ENTITY_META: Record<string, { icon: LucideIcon; description: string }> = {
  vehicles: { icon: Truck, description: "Гос. номера, вид, тип учёта, привязка к договору" },
  drivers: { icon: Contact, description: "ФИО, ИИН, подрядчик, срок допуска по Приложению №2" },
  contractors: { icon: Building2, description: "Субподрядчики и заказчики: реквизиты, банк, НДС" },
  fuel_cards: { icon: CreditCard, description: "Карты АЗС и их операторы" },
  tankers: { icon: Fuel, description: "Бензовозы-склады: название и ёмкость" },
  routes: { icon: Route, description: "Плечо откатки, материал, объём кузова" },
  work_types: { icon: Wrench, description: "Виды работ для табеля смен" },
  downtime_records: { icon: ClipboardX, description: "Часы простоя, чья вина, акты простоя" },
  penalties: { icon: Gavel, description: "Удержания по договорам с основанием" },
};

/** Справочники с флагом is_active — для них показываем, сколько записей скрыто. */
const ACTIVE_TABLES = [
  "vehicles", "drivers", "contractors", "fuel_cards", "tankers", "routes", "work_types",
] as const;
/** Остальные таблицы со счётчиком — только общее число. */
const PLAIN_TABLES = [
  "downtime_records", "penalties", "contracts", "document_templates", "profiles",
] as const;

interface CountInfo {
  total: number;
  inactive: number;
}

/** Счётчики записей: только `count`, без выборки строк — все запросы параллельно. */
async function loadCounts(): Promise<Record<string, CountInfo>> {
  // Динамические имена таблиц — нетипизированный клиент, как в [entity]/page.tsx.
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const head = (table: string, activeOnly = false) => {
    const q = supabase.from(table).select("*", { count: "exact", head: true });
    return activeOnly ? q.eq("is_active", true) : q;
  };

  const counts: Record<string, CountInfo> = {};
  await Promise.all([
    ...ACTIVE_TABLES.map(async (t) => {
      const [all, active] = await Promise.all([head(t), head(t, true)]);
      const total = all.count ?? 0;
      counts[t] = { total, inactive: total - (active.count ?? 0) };
    }),
    ...PLAIN_TABLES.map(async (t) => {
      const res = await head(t);
      counts[t] = { total: res.count ?? 0, inactive: 0 };
    }),
  ]);
  return counts;
}

interface CardDef {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Ключ в счётчиках; не задан — раздел-инструмент без списка записей. */
  countKey?: string;
}

/** Карточка справочника из реестра: название — из реестра, вид — отсюда. */
function entityCard(slug: string): CardDef {
  const meta = ENTITY_META[slug] ?? { icon: Wrench, description: "" };
  return {
    href: `/fleet/admin/${slug}`,
    title: ENTITIES[slug].title,
    description: meta.description,
    icon: meta.icon,
    countKey: slug,
  };
}

const SECTIONS: { title: string; cards: CardDef[]; adminOnly?: boolean }[] = [
  {
    title: "Парк и люди",
    cards: [entityCard("vehicles"), entityCard("drivers"), entityCard("contractors")],
  },
  {
    title: "Договоры и расчёты",
    cards: [
      {
        href: "/fleet/admin/contracts",
        title: "Договоры и прайсы",
        description: "Договоры субподряда, ставки и цены ГСМ по периодам",
        icon: FileSignature,
        countKey: "contracts",
      },
      {
        href: "/fleet/admin/avr",
        title: "Справочник АВР",
        description: "ИП → машины → версии условий: час, рейс, ГСМ",
        icon: Calculator,
      },
      {
        href: "/fleet/admin/templates",
        title: "Шаблоны документов",
        description: "DOCX-шаблоны актов и договорных документов",
        icon: FileType2,
        countKey: "document_templates",
      },
    ],
  },
  {
    title: "Простои и удержания",
    cards: [entityCard("downtime_records"), entityCard("penalties")],
  },
  {
    title: "Инфраструктура объекта",
    cards: [
      entityCard("fuel_cards"),
      entityCard("tankers"),
      entityCard("routes"),
      entityCard("work_types"),
    ],
  },
  {
    title: "Инструменты",
    cards: [
      {
        href: "/fleet/admin/qr",
        title: "QR-наклейки на технику",
        description: "Печать наклеек для скана машины в поле",
        icon: QrCode,
      },
      {
        href: "/fleet/admin/settings",
        title: "Настройки детекторов",
        description: "Пороги срабатывания детекторов аномалий",
        icon: SlidersHorizontal,
      },
      {
        href: "/fleet/admin/forecast",
        title: "Параметры прогноза",
        description: "Якорь и цель по объёму, м³ — для вкладки «Объём»",
        icon: Mountain,
      },
      {
        href: "/fleet/admin/audit",
        title: "Журнал изменений",
        description: "Кто, что и когда правил в системе",
        icon: History,
      },
    ],
  },
  {
    title: "Администрирование",
    adminOnly: true,
    cards: [
      {
        href: "/fleet/admin/users",
        title: "Пользователи и роли",
        description: "Доступы сотрудников и их роли в системе",
        icon: ShieldCheck,
        countKey: "profiles",
      },
    ],
  },
];

/**
 * Справочник, добавленный в реестр, но не разложенный по секциям выше, не должен
 * молча пропасть с хаба — показываем его в «Прочем».
 */
const COVERED = new Set(
  SECTIONS.flatMap((s) => s.cards.map((c) => c.countKey)).filter(
    (key): key is string => key !== undefined && key in ENTITIES,
  ),
);
const UNCOVERED = Object.keys(ENTITIES).filter((slug) => !COVERED.has(slug));

export default async function AdminHome() {
  const [current, counts] = await Promise.all([getCurrentProfile(), loadCounts()]);
  const isAdmin = current?.profile?.roles.includes("admin") ?? false;
  const sections = [
    ...SECTIONS.filter((s) => !s.adminOnly || isAdmin),
    ...(UNCOVERED.length
      ? [{ title: "Прочее", cards: UNCOVERED.map(entityCard), adminOnly: false }]
      : []),
  ];

  return (
    <AppShell
      requiredRoles={["admin", "office"]}
      title="Справочники"
      description="Данные, на которых стоит учёт: парк и люди, договоры, инфраструктура объекта."
      actions={<ExportDirectoriesButton />}
    >
      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <section key={section.title} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.cards.map((card) => {
                const info = card.countKey ? counts[card.countKey] : undefined;
                return (
                  <AdminCard
                    key={card.href}
                    href={card.href}
                    title={card.title}
                    description={card.description}
                    icon={card.icon}
                    count={info?.total}
                    note={info && info.inactive > 0 ? `${info.inactive} скрыто` : undefined}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
