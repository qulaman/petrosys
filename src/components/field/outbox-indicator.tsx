"use client";

import { useEffect, useState } from "react";
import { CloudOff, WifiOff } from "lucide-react";
import { allEntries, KIND_LABELS, OUTBOX_CHANGED } from "@/lib/outbox/outbox";
import { cn } from "@/lib/utils";

/**
 * Состояние связи и очереди — в шапке на всех экранах.
 *
 * До этого узнать, что связи нет или что запись не ушла, можно было только на
 * экране рейсов. Человек в поле уходил с объекта, считая работу сданной.
 */
export function OutboxIndicator({ className }: { className?: string }) {
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState<{ count: number; kinds: string[] }>({ count: 0, kinds: [] });

  useEffect(() => {
    const syncOnline = () => setOffline(!navigator.onLine);
    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const list = await allEntries();
      if (!alive) return;
      setPending({ count: list.length, kinds: [...new Set(list.map((e) => e.kind))] });
    };
    void read();
    window.addEventListener(OUTBOX_CHANGED, read);
    // Очередь могла измениться в другой вкладке — редко, но проверяем.
    const t = setInterval(read, 20_000);
    return () => {
      alive = false;
      window.removeEventListener(OUTBOX_CHANGED, read);
      clearInterval(t);
    };
  }, []);

  if (!offline && pending.count === 0) return null;

  const kinds = pending.kinds.map((k) => KIND_LABELS[k] ?? k).join(", ");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        offline
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-info/40 bg-info/10 text-info",
        className,
      )}
      title={
        offline
          ? "Нет связи. Записи сохраняются на телефоне и уйдут сами, когда связь появится."
          : `Ожидают отправки: ${kinds}. Уйдут автоматически.`
      }
    >
      {offline ? <WifiOff className="size-3.5" /> : <CloudOff className="size-3.5" />}
      {offline ? "Нет связи" : "Не отправлено"}
      {pending.count > 0 ? <b className="tabular-nums">{pending.count}</b> : null}
    </span>
  );
}
