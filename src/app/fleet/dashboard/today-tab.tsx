"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Droplet, Fuel, MapPin, Radio, Timer, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtInt, fmtLiters, fmtTime } from "@/lib/format";
import { ANOMALY_LABELS } from "@/lib/anomalies";
import { cn } from "@/lib/utils";
import type { FeedEvent, TodayData } from "@/lib/data/dashboard";

/** Δ ко вчера (к этому же часу): стрелка и знак; серым при нуле. */
function Delta({ now, prev }: { now: number; prev: number }) {
  const diff = now - prev;
  if (prev === 0 && now === 0) return null;
  return (
    <span
      className={cn("text-xs tabular-nums", diff > 0 ? "text-green-600" : diff < 0 ? "text-destructive" : "text-muted-foreground")}
      title="Сравнение со вчерашним днём до этого же часа"
    >
      {diff > 0 ? "▲" : diff < 0 ? "▼" : "•"} {diff > 0 ? "+" : ""}{fmtInt(diff)} ко вчера к этому часу
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
    <div className={cn("flex flex-col gap-1 rounded-lg border p-4", href ? "transition-colors hover:bg-accent" : "")}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-3xl font-bold tabular-nums">{value}</span>
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
      setEvents((prev) => [e, ...prev].slice(0, 30));
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

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Техника на линии" value={`${techOnline}/${data.techTotal}`} icon={Truck} sub="с записью сегодня" />
        <StatTile label="Рейсов сегодня" value={fmtInt(tripsToday)} icon={Truck}
          href="/fleet/journals/trips?period=today" delta={<Delta now={tripsToday} prev={data.prev.trips} />} />
        <StatTile label="Часов записано" value={fmtInt(hoursToday)} icon={Timer}
          href="/fleet/journals/shifts?period=today" delta={<Delta now={hoursToday} prev={data.prev.hours} />} />
        <StatTile label="Литров выдано" value={fmtInt(litersCard + litersTanker)} icon={Fuel}
          href="/fleet/journals/fuel?period=today"
          delta={<Delta now={litersCard + litersTanker} prev={data.prev.liters} />}
          sub={`карта ${fmtInt(litersCard)} · бензовоз ${fmtInt(litersTanker)}`} />
      </div>

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
                <span className="ml-auto text-xs text-muted-foreground">{fmtTime(a.detected_at)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {data.tankerBalances.length ? (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">Остатки бензовозов</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.tankerBalances.map((t) => (
              <div key={t.tanker_id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.last_measured_at ? `замер ${fmtTime(t.last_measured_at)}` : "замеров не было"}
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
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Живая лента</p>
          <span className={cn("flex items-center gap-1 text-xs", live ? "text-green-600" : "text-muted-foreground")}>
            <Radio className="size-3" /> {live ? "онлайн" : "…"}
          </span>
        </div>
        <div className="flex flex-col divide-y rounded-lg border">
          {events.map((e) => (
            <div key={`${e.kind}-${e.id}`} className="flex items-center gap-3 p-3 text-sm">
              {e.kind === "fuel" ? <Droplet className="size-4 text-blue-600" /> : e.kind === "trip" ? <Truck className="size-4 text-green-600" /> : <Timer className="size-4 text-violet-600" />}
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{KIND_LABEL[e.kind]}</span>
              <span className="flex-1 font-medium">{data.vehicleNames[e.vehicle_id] ?? "—"}</span>
              <span className="text-muted-foreground">{e.detail}</span>
              <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{fmtTime(e.at)}</span>
            </div>
          ))}
          {events.length === 0 ? <p className="p-3 text-sm text-muted-foreground">Событий сегодня пока нет</p> : null}
        </div>
      </section>

      {/* Гео-точки записей — учёт идёт по всему объекту */}
      {data.geoPoints.length ? (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">Последние гео-точки записей</p>
          <div className="flex flex-col divide-y rounded-lg border">
            {data.geoPoints.map((g, i) => (
              <a
                key={i}
                href={`https://maps.google.com/?q=${g.lat},${g.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-3 text-sm hover:bg-accent"
              >
                <MapPin className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-medium">{g.reg}</span>
                <span className="text-muted-foreground">{g.kind === "fuel" ? "заправка" : "рейс"}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {g.lat.toFixed(5)}, {g.lng.toFixed(5)} · {fmtTime(g.at)}
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
