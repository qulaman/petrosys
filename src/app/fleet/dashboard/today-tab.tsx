"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, ChevronDown, Coins, Droplet, ExternalLink, Fuel, MapPin, Radio, Timer, Truck,
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
const FEED_FILTERS: { key: "all" | FeedEvent["kind"]; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "fuel", label: "Заправки" },
  { key: "trip", label: "Рейсы" },
  { key: "shift", label: "Смены" },
];

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

  useEffect(() => {
    const supabase = createClient();
    // Не задваиваем события, уже попавшие в серверную выборку.
    const seen = new Set(data.recentEvents.map((e) => e.id));

    const channel = supabase
      .channel("dashboard-today")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "fuel_issues" }, (p) => {
        const r = p.new as { id: string; created_at: string; liters: number; source_type: string; vehicle_id: string; driver_id: string };
        if (!push({ id: r.id, kind: "fuel", at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id, detail: `${Number(r.liters)} л · ${r.source_type === "card" ? "карта" : "бензовоз"}` })) return;
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
        if (!push({ id: r.id, kind: "shift", at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id, detail: `${Number(r.hours)} ч` })) return;
        setInc((s) => ({ ...s, hours: s.hours + Number(r.hours), vehicleIds: [...s.vehicleIds, r.vehicle_id] }));
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    /** true — событие новое (лента и плитки обновляются), false — дубль. */
    function push(e: FeedEvent): boolean {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      setEvents((prev) => [e, ...prev].slice(0, 50));
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
  const visibleEvents = feedFilter === "all" ? events : events.filter((e) => e.kind === feedFilter);

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
          {visibleEvents.map((e) => (
            <div key={`${e.kind}-${e.id}`} className="flex items-center gap-3 p-3 text-sm">
              {e.kind === "fuel" ? <Droplet className="size-4 text-blue-600" /> : e.kind === "trip" ? <Truck className="size-4 text-green-600" /> : <Timer className="size-4 text-violet-600" />}
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{KIND_LABEL[e.kind]}</span>
              <span className="flex-1 font-medium">{data.vehicleNames[e.vehicle_id] ?? "—"}</span>
              <span className="text-muted-foreground">{e.detail}</span>
              <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{fmtTime(e.at)}</span>
            </div>
          ))}
          {visibleEvents.length === 0 ? (
            <EmptyState
              icon={Activity}
              title={events.length === 0 ? "Событий сегодня пока нет" : "Событий этого типа пока нет"}
              description="Заправки, рейсы и смены появляются здесь в реальном времени."
              className="border-0 p-6"
            />
          ) : null}
        </div>
      </section>

      {/* Последние гео-точки: по одной на машину — учёт идёт по всему объекту */}
      {data.geoPoints.length ? (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            Где техника <span className="text-muted-foreground">· последняя гео-точка каждой машины за сегодня</span>
          </p>
          <div className="flex flex-col divide-y rounded-lg border">
            {data.geoPoints.map((g) => (
              <a
                key={g.reg}
                href={`https://maps.google.com/?q=${g.lat},${g.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-3 text-sm hover:bg-accent"
              >
                <MapPin className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{g.reg}</span>
                <span className="text-muted-foreground">{g.kind === "fuel" ? "заправка" : "рейс"} · {fmtTime(g.at)}</span>
                <span className="ml-auto flex items-center gap-1 text-xs text-primary">
                  Карта <ExternalLink className="size-3" />
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
