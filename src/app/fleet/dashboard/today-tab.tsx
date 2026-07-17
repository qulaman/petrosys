"use client";

import { useEffect, useState } from "react";
import { Droplet, Fuel, Radio, Timer, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtInt, fmtLiters, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FeedEvent, TodayData } from "@/lib/data/dashboard";

function StatTile({
  label, value, sub, icon: Icon,
}: {
  label: string; value: string; sub?: string; icon: React.ElementType;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-3xl font-bold tabular-nums">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

const KIND_LABEL: Record<FeedEvent["kind"], string> = {
  fuel: "Заправка",
  trip: "Рейс",
  shift: "Смена",
};

export function TodayTab({ data }: { data: TodayData }) {
  const [events, setEvents] = useState<FeedEvent[]>(data.recentEvents);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const vName = (id: string) => data.vehicleNames[id] ?? "—";

    const channel = supabase
      .channel("dashboard-today")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "fuel_issues" }, (p) => {
        const r = p.new as { id: string; created_at: string; liters: number; source_type: string; vehicle_id: string; driver_id: string };
        pushEvent({ id: r.id, kind: "fuel", at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id, detail: `${Number(r.liters)} л · ${r.source_type === "card" ? "карта" : "бензовоз"}` });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_records" }, (p) => {
        const r = p.new as { id: string; created_at: string; vehicle_id: string; driver_id: string };
        pushEvent({ id: r.id, kind: "trip", at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id, detail: "рейс" });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shift_records" }, (p) => {
        const r = p.new as { id: string; created_at: string; vehicle_id: string; driver_id: string; hours: number };
        pushEvent({ id: r.id, kind: "shift", at: r.created_at, vehicle_id: r.vehicle_id, driver_id: r.driver_id, detail: `${Number(r.hours)} ч` });
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    function pushEvent(e: FeedEvent) {
      setEvents((prev) => [e, ...prev.filter((x) => x.id !== e.id)].slice(0, 30));
    }

    void vName;
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [data.vehicleNames]);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Техника на линии" value={`${data.techOnline}/${data.techTotal}`} icon={Truck} sub="с записью сегодня" />
        <StatTile label="Рейсов сегодня" value={fmtInt(data.tripsToday)} icon={Truck} />
        <StatTile label="Часов записано" value={fmtInt(data.hoursToday)} icon={Timer} />
        <StatTile label="Литров выдано" value={fmtInt(data.litersCard + data.litersTanker)} icon={Fuel} sub={`карта ${fmtInt(data.litersCard)} · бензовоз ${fmtInt(data.litersTanker)}`} />
      </div>

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
    </div>
  );
}
