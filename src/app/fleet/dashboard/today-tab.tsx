"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, ChevronDown, Coins, Droplet, ExternalLink, Fuel, Radio, Timer, Truck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { EmptyState } from "@/components/ui/empty-state";
import { fmtInt, fmtLiters, fmtMoney, fmtTime } from "@/lib/format";
import { ANOMALY_LABELS } from "@/lib/anomalies";
import { aqtobeDate } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { FeedEvent, TodayData } from "@/lib/data/dashboard";

/** Δ ко вчера (к этому же часу): стрелка и знак; серым при нуле. */
function Delta({ now, prev, fmt = fmtInt }: { now: number; prev: number; fmt?: (n: number) => string }) {
  const diff = now - prev;
  if (prev === 0 && now === 0) return null;
  return (
    <span
      className={cn("text-xs tabular-nums", diff > 0 ? "text-green-600" : diff < 0 ? "text-destructive" : "text-muted-foreground")}
      title="Сравнение со вчерашним днём до этого же часа"
    >
      {diff > 0 ? "▲" : diff < 0 ? "▼" : "•"} {diff > 0 ? "+" : ""}{fmt(diff)} ко вчера к этому часу
    </span>
  );
}

function StatTile({
  label, value, sub, icon: Icon, href, delta,
}: {
  label: string; value: string; sub?: string; icon: React.ElementType;
  href?: string; delta?: React.ReactNode;
}) {
  const body = (
    <div className={cn("flex h-full flex-col gap-1 rounded-lg border p-4", href ? "transition-colors hover:bg-accent" : "")}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-2xl font-bold tabular-nums lg:text-3xl">{value}</span>
      {delta}
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const KIND_LABEL: Record<FeedEvent["kind"], string> = {
  fuel: "Заправка",
  trip: "Рейс",
  shift: "Смена",
};
const KIND_GROUP_LABEL: Record<FeedEvent["kind"], string> = {
  fuel: "Заправки",
  trip: "Рейсы",
  shift: "Смены",
};
const KIND_JOURNAL: Record<FeedEvent["kind"], string> = {
  fuel: "/fleet/journals/fuel",
  trip: "/fleet/journals/trips",
  shift: "/fleet/journals/shifts",
};
const FEED_FILTERS: { key: "all" | FeedEvent["kind"]; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "fuel", label: "Заправки" },
  { key: "trip", label: "Рейсы" },
  { key: "shift", label: "Смены" },
];

// ---------------------------------------------------------------------------
// Группировка ленты: подряд идущие события одного типа (разрыв ≤ 60 мин)
// схлопываются в группу; лента размечается разделителями часов.
// ---------------------------------------------------------------------------
const GROUP_GAP_MS = 60 * 60_000;
/** Серии от MIN_GROUP событий сворачиваются в компактную строку. */
const MIN_GROUP = 3;

interface FeedGroup {
  /** Ключ по САМОМУ СТАРОМУ событию — стабилен при появлении новых сверху. */
  key: string;
  kind: FeedEvent["kind"];
  events: FeedEvent[]; // свежие первыми
}
type FeedItem = { type: "hour"; label: string } | ({ type: "group" } & FeedGroup);

const hourFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Aqtobe", hour: "2-digit" });

function buildFeed(events: FeedEvent[]): FeedItem[] {
  const groups: FeedGroup[] = [];
  for (const e of events) {
    const g = groups[groups.length - 1];
    if (g && g.kind === e.kind && Date.parse(g.events[g.events.length - 1].at) - Date.parse(e.at) <= GROUP_GAP_MS) {
      g.events.push(e);
      g.key = `${g.kind}-${e.id}`;
    } else {
      groups.push({ key: `${e.kind}-${e.id}`, kind: e.kind, events: [e] });
    }
  }
  const items: FeedItem[] = [];
  let lastHour = "";
  for (const g of groups) {
    const hour = `${hourFmt.format(new Date(g.events[0].at))}:00`;
    if (hour !== lastHour) {
      items.push({ type: "hour", label: hour });
      lastHour = hour;
    }
    items.push({ type: "group", ...g });
  }
  return items;
}

/** Сводка группы: «12 · 7 машин», «5 · 830 л (карта 620 · бензовоз 210)», «4 · 38 ч». */
function groupSummary(g: FeedGroup): { main: string; sub: string | null } {
  const n = g.events.length;
  if (g.kind === "trip") {
    const vehicles = new Set(g.events.map((e) => e.vehicle_id)).size;
    return { main: `${KIND_GROUP_LABEL.trip} · ${n}`, sub: `${vehicles} маш.` };
  }
  if (g.kind === "fuel") {
    const card = g.events.reduce((s, e) => s + (e.source === "card" ? e.liters ?? 0 : 0), 0);
    const tanker = g.events.reduce((s, e) => s + (e.source === "tanker" ? e.liters ?? 0 : 0), 0);
    return {
      main: `${KIND_GROUP_LABEL.fuel} · ${n} · ${fmtInt(card + tanker)} л`,
      sub: `карта ${fmtInt(card)} · бензовоз ${fmtInt(tanker)}`,
    };
  }
  const hours = g.events.reduce((s, e) => s + (e.hours ?? 0), 0);
  return { main: `${KIND_GROUP_LABEL.shift} · ${n} · ${fmtInt(hours)} ч`, sub: null };
}

function KindIcon({ kind, className }: { kind: FeedEvent["kind"]; className?: string }) {
  if (kind === "fuel") return <Droplet className={cn("size-4 text-blue-600", className)} />;
  if (kind === "trip") return <Truck className={cn("size-4 text-green-600", className)} />;
  return <Timer className={cn("size-4 text-violet-600", className)} />;
}

/** Приращения к серверным значениям из realtime-событий (плитки живут вместе с лентой). */
interface LiveInc {
  trips: number;
  hours: number;
  litersCard: number;
  litersTanker: number;
  vehicleIds: string[];
}

export function TodayTab({ data }: { data: TodayData }) {
  const [events, setEvents] = useState<FeedEvent[]>(data.recentEvents);
  const [live, setLive] = useState(false);
  const [feedFilter, setFeedFilter] = useState<"all" | FeedEvent["kind"]>("all");
  const [notOutOpen, setNotOutOpen] = useState(false);
  const [inc, setInc] = useState<LiveInc>({ trips: 0, hours: 0, litersCard: 0, litersTanker: 0, vehicleIds: [] });
  // Лента: раскрытые группы, подсветка свежепришедших, порция «Показать ещё».
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [shownItems, setShownItems] = useState(30);

  useEffect(() => {
    const supabase = createClient();
    // Не задваиваем события, уже попавшие в серверную выборку.
    const seen = new Set(data.recentEvents.map((e) => e.id));

    const channel = supabase
      .channel("dashboard-today")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "fuel_issues" }, (p) => {
        const r = p.new as { id: string; created_at: string; liters: number; source_type: string; vehicle_id: string; driver_id: string };
        if (!push({ id: r.id, kind: "fuel", at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id, detail: `${Number(r.liters)} л · ${r.source_type === "card" ? "карта" : "бензовоз"}`, liters: Number(r.liters), source: r.source_type === "card" ? "card" : "tanker" })) return;
        setInc((s) => ({
          ...s,
          litersCard: s.litersCard + (r.source_type === "card" ? Number(r.liters) : 0),
          litersTanker: s.litersTanker + (r.source_type === "card" ? 0 : Number(r.liters)),
          vehicleIds: [...s.vehicleIds, r.vehicle_id],
        }));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_records" }, (p) => {
        const r = p.new as { id: string; created_at: string; vehicle_id: string; driver_id: string };
        if (!push({ id: r.id, kind: "trip", at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id, detail: "рейс" })) return;
        setInc((s) => ({ ...s, trips: s.trips + 1, vehicleIds: [...s.vehicleIds, r.vehicle_id] }));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shift_records" }, (p) => {
        const r = p.new as { id: string; created_at: string; vehicle_id: string; driver_id: string; hours: number };
        if (!push({ id: r.id, kind: "shift", at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id, detail: `${Number(r.hours)} ч`, hours: Number(r.hours) })) return;
        setInc((s) => ({ ...s, hours: s.hours + Number(r.hours), vehicleIds: [...s.vehicleIds, r.vehicle_id] }));
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    /** true — событие новое (лента и плитки обновляются), false — дубль. */
    function push(e: FeedEvent): boolean {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      setEvents((prev) => [e, ...prev]);
      // Подсветка свежепришедшего: пара секунд мягкого фона, затем затухание.
      setFlashIds((prev) => new Set(prev).add(e.id));
      setTimeout(() => {
        setFlashIds((prev) => {
          const next = new Set(prev);
          next.delete(e.id);
          return next;
        });
      }, 2500);
      return true;
    }

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [data.recentEvents]);

  const techOnline = useMemo(
    () => new Set([...data.onlineVehicleIds, ...inc.vehicleIds]).size,
    [data.onlineVehicleIds, inc.vehicleIds],
  );
  const tripsToday = data.tripsToday + inc.trips;
  const hoursToday = data.hoursToday + inc.hours;
  const litersCard = data.litersCard + inc.litersCard;
  const litersTanker = data.litersTanker + inc.litersTanker;

  const feedCounts = useMemo(() => {
    const m = { all: events.length, fuel: 0, trip: 0, shift: 0 };
    for (const e of events) m[e.kind] += 1;
    return m;
  }, [events]);
  const feedItems = useMemo(
    () => buildFeed(feedFilter === "all" ? events : events.filter((e) => e.kind === feedFilter)),
    [events, feedFilter],
  );
  const visibleItems = feedItems.slice(0, shownItems);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Время для «Требует внимания»: несегодняшним — с датой, иначе выглядит как сегодня. */
  const fmtWhen = (iso: string) => {
    const d = aqtobeDate(iso);
    return d === data.date ? fmtTime(iso) : `${d.slice(8, 10)}.${d.slice(5, 7)} ${fmtTime(iso)}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Техника на линии" value={`${techOnline}/${data.techTotal}`} icon={Truck} sub="с записью сегодня" />
        <StatTile label="Рейсов сегодня" value={fmtInt(tripsToday)} icon={Truck}
          href="/fleet/journals/trips?period=today" delta={<Delta now={tripsToday} prev={data.prev.trips} />} />
        <StatTile label="Часов записано" value={fmtInt(hoursToday)} icon={Timer}
          href="/fleet/journals/shifts?period=today" delta={<Delta now={hoursToday} prev={data.prev.hours} />}
          sub="включая черновики журналов" />
        <StatTile label="Литров выдано" value={fmtInt(litersCard + litersTanker)} icon={Fuel}
          href="/fleet/journals/fuel?period=today"
          delta={<Delta now={litersCard + litersTanker} prev={data.prev.liters} />}
          sub={`карта ${fmtInt(litersCard)} · бензовоз ${fmtInt(litersTanker)}`} />
        <StatTile label="Начислено сегодня" value={fmtMoney(data.accruedToday)} icon={Coins}
          delta={<Delta now={data.accruedToday} prev={data.prev.accrued} fmt={fmtMoney} />}
          sub="оценка по ставкам · включая черновики" />
      </div>

      {/* Выход на линию: план учётчика против факта */}
      <section className="flex flex-col gap-2">
        {data.lineup.planned > 0 ? (
          <div className={cn(
            "flex flex-col gap-2 rounded-lg border p-4",
            data.lineup.notOutRegs.length > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-green-600/40 bg-green-600/5",
          )}>
            <button
              type="button"
              onClick={() => data.lineup.notOutRegs.length && setNotOutOpen((v) => !v)}
              className="flex items-center gap-2 text-left"
            >
              <Truck className={cn("size-5 shrink-0", data.lineup.notOutRegs.length ? "text-amber-600" : "text-green-600")} />
              <span className="font-medium">
                Выход на линию: выведено {fmtInt(data.lineup.planned)} · работает {fmtInt(data.lineup.worked)}
                {data.lineup.notOutRegs.length > 0 ? (
                  <span className="text-destructive"> · не вышло {data.lineup.notOutRegs.length}</span>
                ) : (
                  <span className="text-green-600"> · все в работе</span>
                )}
              </span>
              {data.lineup.notOutRegs.length > 0 ? (
                <ChevronDown className={cn("ml-auto size-4 transition-transform", notOutOpen ? "rotate-180" : "")} />
              ) : null}
            </button>
            {notOutOpen ? (
              <p className="text-sm text-muted-foreground">Без рейсов: {data.lineup.notOutRegs.join(", ")}</p>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={Truck}
            title="Выводы на линию сегодня не заполнялись"
            description="Учётчик выводит самосвалы на линию на экране «Рейсы» — тогда здесь появится план/факт и список не вышедших машин."
            className="p-5"
          />
        )}
      </section>

      {/* Требует внимания */}
      {data.attention.length ? (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">Требует внимания</p>
          <div className="flex flex-col divide-y rounded-lg border border-amber-500/40">
            {data.attention.map((a) => (
              <Link key={a.id} href="/fleet/dashboard/anomalies" className="flex items-center gap-2 p-3 text-sm hover:bg-accent">
                <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                <span className="font-medium">{ANOMALY_LABELS[a.type] ?? a.type}</span>
                {a.reg ? <span className="text-muted-foreground">· {a.reg}</span> : null}
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{fmtWhen(a.detected_at)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {data.tankerBalances.length ? (
        <section className="flex flex-col gap-2">
          <Link href="/fleet/fuel/tanker" className="flex items-center gap-1 text-sm font-medium hover:underline">
            Остатки бензовозов <ExternalLink className="size-3.5 text-muted-foreground" />
          </Link>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.tankerBalances.map((t) => (
              <div key={t.tanker_id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.last_measured_at ? `замер ${fmtWhen(t.last_measured_at)}` : "замеров не было"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold tabular-nums">{fmtLiters(t.calculated_liters)}</p>
                  {t.stale ? <p className="text-xs text-amber-600">давно не мерили</p> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">Живая лента</p>
          <span className={cn("flex items-center gap-1 text-xs", live ? "text-green-600" : "text-muted-foreground")}>
            <Radio className="size-3" /> {live ? "онлайн" : "…"}
          </span>
          <div className="ml-auto flex gap-1">
            {FEED_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFeedFilter(f.key)}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs font-medium",
                  feedFilter === f.key ? "bg-accent" : "hover:bg-accent",
                )}
              >
                {f.label} · {feedCounts[f.key]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col divide-y rounded-lg border">
          {visibleItems.map((item) => {
            if (item.type === "hour") {
              return (
                <div key={`h-${item.label}`} className="bg-muted/40 px-3 py-1 text-center text-xs font-medium text-muted-foreground">
                  {item.label}
                </div>
              );
            }
            const isOpen = openGroups.has(item.key);
            const hasFlash = item.events.some((e) => flashIds.has(e.id));
            // Короткие серии — обычными строками; длинные — компактной группой.
            if (item.events.length < MIN_GROUP || isOpen) {
              return (
                <div key={item.key} className="flex flex-col divide-y">
                  {item.events.length >= MIN_GROUP ? (
                    <button type="button" onClick={() => toggleGroup(item.key)} className="flex items-center gap-2 bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-accent">
                      <KindIcon kind={item.kind} className="size-3.5" />
                      {groupSummary(item).main}
                      <ChevronDown className="ml-auto size-3.5 rotate-180" />
                    </button>
                  ) : null}
                  {item.events.map((e) => (
                    <Link
                      key={e.id}
                      href={`${KIND_JOURNAL[e.kind]}?vehicle=${e.vehicle_id}&period=today`}
                      title="Открыть журнал машины за сегодня"
                      className={cn(
                        "flex items-center gap-3 p-3 text-sm transition-colors duration-1000 hover:bg-accent",
                        flashIds.has(e.id) ? "bg-primary/10" : "",
                      )}
                    >
                      <KindIcon kind={e.kind} />
                      <span className="w-20 shrink-0 text-xs text-muted-foreground">{KIND_LABEL[e.kind]}</span>
                      <span className="font-medium">{data.vehicleNames[e.vehicle_id] ?? "—"}</span>
                      <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                        {data.driverNames[e.driver_id] ?? ""}
                      </span>
                      <span className="ml-auto text-muted-foreground">{e.detail}</span>
                      <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{fmtTime(e.at)}</span>
                    </Link>
                  ))}
                </div>
              );
            }
            const s = groupSummary(item);
            const oldest = item.events[item.events.length - 1];
            const newest = item.events[0];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleGroup(item.key)}
                className={cn(
                  "flex items-center gap-3 p-3 text-left text-sm transition-colors duration-1000 hover:bg-accent",
                  hasFlash ? "bg-primary/10" : "",
                )}
                title="Раскрыть события группы"
              >
                <KindIcon kind={item.kind} />
                <span className="font-semibold">{s.main}</span>
                {s.sub ? <span className="hidden text-xs text-muted-foreground sm:inline">{s.sub}</span> : null}
                <ChevronDown className="size-4 text-muted-foreground" />
                <span className="ml-auto w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {fmtTime(oldest.at)}–{fmtTime(newest.at)}
                </span>
              </button>
            );
          })}
          {feedItems.length === 0 ? (
            <EmptyState
              icon={Activity}
              title={events.length === 0 ? "Событий сегодня пока нет" : "Событий этого типа пока нет"}
              description="Заправки, рейсы и смены появляются здесь в реальном времени."
              className="border-0 p-6"
            />
          ) : null}
        </div>
        {feedItems.length > shownItems ? (
          <button
            type="button"
            onClick={() => setShownItems((n) => n + 50)}
            className="self-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Показать ещё ({feedItems.length - shownItems})
          </button>
        ) : null}
      </section>

    </div>
  );
}
