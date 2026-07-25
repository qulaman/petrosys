"use client";

import { RotateCw, X } from "lucide-react";
import type { OutboxEntry } from "@/lib/outbox/outbox";

/**
 * Лента неотправленных записей экрана: что именно стоит в очереди и почему
 * не ушло. Причину показываем — раньше `error` хранился, но никому не виден,
 * и человек не понимал, ждать ему связи или запись отклонена по сути.
 */
export function OutboxList({
  entries,
  onRemove,
}: {
  entries: OutboxEntry[];
  onRemove: (id: string) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col divide-y rounded-lg border">
      {entries.map((e) => (
        <div key={e.id} className="flex items-start gap-2 p-3 text-sm">
          <RotateCw
            className={`mt-0.5 size-4 shrink-0 ${e.status === "error" ? "text-destructive" : "text-warning"}`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{e.label}</p>
            <p className="text-xs text-muted-foreground">
              {e.status === "error"
                ? (e.error ?? "не отправлено") + (e.attempts > 1 ? ` · попыток: ${e.attempts}` : "")
                : "отправляется…"}
            </p>
          </div>
          {e.status === "error" ? (
            <button
              onClick={() => onRemove(e.id)}
              aria-label="Убрать неотправленную запись"
              className="-my-2 flex size-11 shrink-0 items-center justify-center"
            >
              <X className="size-4 text-muted-foreground" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
