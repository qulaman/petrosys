import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { aqtobeDate } from "@/lib/tz";
import { ANOMALY_LABELS, PENALTY_TYPES } from "@/lib/anomalies";
import { AnomaliesClient, type AnomalyRow } from "./anomalies-client";

type Refs = Record<string, unknown>;

const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

const MONTH_NAMES = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const monthLabel = (ym: string) => MONTH_NAMES[Number(ym.slice(5, 7)) - 1] ?? ym;

function lastOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, "0")}`;
}
const dayQ = (d: string) => `period=custom&from=${d}&to=${d}`;
const monthQ = (ym: string) => `period=custom&from=${ym}-01&to=${lastOfMonth(ym)}`;

interface Thresholds {
  tankerGap: number;
  noFuelTrips: number;
  noFuelHours: number;
}

/** Человекочитаемая карточка: краткая строка, объяснение правила, ссылки на первичку. */
function present(
  type: string,
  refs: Refs,
  reg: string | null,
  driver: string | null,
  th: Thresholds,
): { summary: string; explanation: string; links: { label: string; href: string }[] } {
  const v = String(refs.vehicle_id ?? "");
  const date = String(refs.date ?? "");
  const r = reg ?? "машина";
  const d = driver ?? "водитель";

  switch (type) {
    case "fuel_no_work":
      return {
        summary: `${r}: выдано ${refs.liters} л, работы в этот день нет`,
        explanation: "В день выдачи топлива у машины нет ни рейсов, ни смен — проверьте, куда ушло топливо, или не была ли забыта запись о работе.",
        links: [
          { label: "Журнал ГСМ за день", href: `/fleet/journals/fuel?vehicle=${v}&${dayQ(date)}` },
          { label: "Табель за день", href: `/fleet/journals/shifts?vehicle=${v}&${dayQ(date)}` },
          { label: "Рейсы за день", href: `/fleet/journals/trips?vehicle=${v}&${dayQ(date)}` },
        ],
      };
    case "work_no_fuel":
      return {
        summary: `${r}: работает ${refs.days} дн. подряд без заправок`,
        explanation: `Машина работала ${refs.days} дн. подряд (окно до ${ddmm(date)}), но ни одной выдачи топлива не зафиксировано — возможно, заправки идут мимо учёта. Порог в настройках детекторов: ${th.noFuelTrips} дн. для самосвалов, ${th.noFuelHours} дн. для остальной техники.`,
        links: [
          { label: "Журнал ГСМ машины", href: `/fleet/journals/fuel?vehicle=${v}` },
          { label: "Табель за день", href: `/fleet/journals/shifts?vehicle=${v}&${dayQ(date)}` },
        ],
      };
    case "over_norm": {
      const ym = String(refs.month ?? date.slice(0, 7));
      return {
        summary: `${r}: ${refs.actual} л/ч при норме ${refs.norm} (${monthLabel(ym)})`,
        explanation: "Фактический расход (литры ÷ моточасы) за месяц выше норматива из договора. Можно удержать штраф или сформировать претензию.",
        links: [
          { label: "Журнал ГСМ за месяц", href: `/fleet/journals/fuel?vehicle=${v}&${monthQ(ym)}` },
          { label: "Табель за месяц", href: `/fleet/journals/shifts?vehicle=${v}&${monthQ(ym)}` },
        ],
      };
    }
    case "short_trip_interval":
      return {
        summary: `${r}: интервал ${refs.gap_min} мин при медиане ${refs.median_min} мин`,
        explanation: "Интервал между рейсами меньше половины обычного для этой машины в этот день — рейс мог быть отмечен дважды или «накручен».",
        links: [{ label: "Рейсы за день", href: `/fleet/journals/trips?vehicle=${v}&${dayQ(date)}` }],
      };
    case "driver_double_shift":
      return {
        summary: `${d}: записан и в дневную, и в ночную смену`,
        explanation: "Один водитель не может отработать обе смены за сутки — вероятна ошибка в табеле или подмена водителя.",
        links: [{ label: "Табель за день", href: `/fleet/journals/shifts?${dayQ(date)}` }],
      };
    case "hours_over_11":
      return {
        summary: `${r}: ${refs.hours} ч за смену`,
        explanation: "Смена длиннее 11 часов — проверьте запись в табеле: опечатка или реальная переработка.",
        links: [{ label: "Табель за день", href: `/fleet/journals/shifts?vehicle=${v}&${dayQ(date)}` }],
      };
    case "unapproved_unit": {
      // v3 — агрегат по машине×месяцу; legacy — запись на одну смену.
      const agg = refs.shifts != null;
      const period = agg && refs.to ? `${ddmm(date)}–${ddmm(String(refs.to))}` : ddmm(date);
      return {
        summary: agg
          ? `${r}: ${refs.shifts} смен вне периода допуска (${period})`
          : `${r}: смена ${ddmm(date)} вне периода допуска`,
        explanation: "У машины не заполнен или истёк период допуска (approved_from/approved_to) — обычно это техника без договора. Привяжите договор и заполните допуск в карточке техники, либо подтвердите нарушение.",
        links: [
          { label: "Карточка техники", href: `/fleet/admin/vehicles` },
          { label: "Табель машины за месяц", href: `/fleet/journals/shifts?vehicle=${v}&${monthQ(date.slice(0, 7))}` },
        ],
      };
    }
    case "tanker_gap":
      return {
        summary: `Замер бензовоза: расхождение ${refs.diff} л`,
        explanation: `Замер остатка отличается от расчётного больше допуска (${refs.threshold ?? th.tankerGap} л из настроек детекторов) — возможна утечка, недолив или ошибка замера.`,
        links: [{ label: "Экран бензовоза", href: "/fleet/fuel/tanker" }],
      };
    case "continuous_driving":
      return {
        summary: `${d}: ${refs.hours} ч рейсов подряд с ${refs.from}`,
        explanation: "Рейсы идут без перерыва 15+ минут дольше 4 часов — риск усталости водителя (и потенциально фиктивные рейсы).",
        links: [{ label: "Рейсы за день", href: `/fleet/journals/trips?${dayQ(date)}` }],
      };
    default:
      return { summary: JSON.stringify(refs), explanation: "", links: [] };
  }
}

export default async function AnomaliesPage() {
  const [current, supabase] = await Promise.all([getCurrentProfile(), createClient()]);
  const orgId = current?.profile?.org_id ?? "";

  const admin = createAdminClient();
  const [anomalies, veh, drv, settingsRes, profilesRes] = await Promise.all([
    fetchAll((f, t) =>
      supabase
        .from("anomalies")
        .select("id, type, severity, status, detected_at, entity_refs, resolution_note, reviewed_by")
        .order("detected_at", { ascending: false })
        .order("id")
        .range(f, t),
    ),
    supabase.from("vehicles").select("id, reg_number"),
    supabase.from("drivers").select("id, full_name"),
    supabase.from("org_settings").select("tanker_gap_liters, no_fuel_days_trips, no_fuel_days_hours").maybeSingle(),
    // Имена разобравших: RLS отдаёт только свой профиль — список через admin строго по org_id (инвариант №3).
    admin.from("profiles").select("id, full_name").eq("org_id", orgId),
  ]);

  const vMap = new Map((veh.data ?? []).map((v) => [v.id, v.reg_number]));
  const dMap = new Map((drv.data ?? []).map((d) => [d.id, d.full_name]));
  const pMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p.full_name]));
  const th: Thresholds = {
    tankerGap: Number(settingsRes.data?.tanker_gap_liters ?? 20),
    noFuelTrips: settingsRes.data?.no_fuel_days_trips ?? 2,
    noFuelHours: settingsRes.data?.no_fuel_days_hours ?? 3,
  };

  const rows: AnomalyRow[] = anomalies
    .map((a) => {
      const refs = (a.entity_refs ?? {}) as Refs;
      // Дата события: детекторы v3 всегда пишут 'date'; для старых записей — фолбэки.
      const eventDate =
        (refs.date as string | undefined) ??
        (refs.month ? `${refs.month}-01` : undefined) ??
        (refs.to as string | undefined) ??
        aqtobeDate(a.detected_at);
      const reg = refs.vehicle_id ? vMap.get(String(refs.vehicle_id)) ?? null : null;
      const driver = refs.driver_id ? dMap.get(String(refs.driver_id)) ?? null : null;
      const { summary, explanation, links } = present(a.type, { ...refs, date: eventDate }, reg, driver, th);
      return {
        id: a.id,
        type: a.type,
        typeLabel: ANOMALY_LABELS[a.type] ?? a.type,
        severity: a.severity,
        status: a.status as AnomalyRow["status"],
        detected_at: a.detected_at,
        eventDate,
        reg,
        driver,
        vehicle_id: refs.vehicle_id ? String(refs.vehicle_id) : null,
        summary,
        explanation,
        links,
        note: a.resolution_note,
        reviewedBy: a.reviewed_by ? pMap.get(a.reviewed_by) ?? null : null,
        canPenalty: PENALTY_TYPES.has(a.type),
      };
    })
    .sort((a, b) => (a.eventDate === b.eventDate ? (a.detected_at < b.detected_at ? 1 : -1) : a.eventDate < b.eventDate ? 1 : -1));

  return (
    <AppShell requiredRoles={["admin", "office"]} title="Центр аномалий">
      <AnomaliesClient rows={rows} />
    </AppShell>
  );
}
