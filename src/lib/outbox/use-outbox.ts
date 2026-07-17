"use client";

import { useCallback, useEffect, useState } from "react";
import { devError } from "@/lib/dev-log";
import {
  readOutbox,
  writeOutbox,
  type OutboxEntry,
} from "@/lib/outbox/outbox";

export type SubmitResult = { ok: true } | { ok: false; error: string };

/**
 * Хук retry-очереди для одного типа записей. add() кладёт запись в очередь и
 * сразу пытается отправить; при обрыве сети запись остаётся, счётчик виден,
 * досылка — при возврате сети и по таймеру.
 */
export function useOutbox<T>(
  kind: string,
  submit: (payload: T) => Promise<SubmitResult>,
  onSuccess?: () => void,
) {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);

  const refresh = useCallback(() => {
    setEntries(readOutbox().filter((e) => e.kind === kind));
  }, [kind]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const flush = useCallback(async () => {
    const targets = readOutbox().filter(
      (e) => e.kind === kind && e.status !== "sending",
    );
    for (const e of targets) {
      writeOutbox(
        readOutbox().map((x) =>
          x.id === e.id ? { ...x, status: "sending" } : x,
        ),
      );
      refresh();
      try {
        const res = await submit(e.payload as T);
        if (res.ok) {
          writeOutbox(readOutbox().filter((x) => x.id !== e.id));
          onSuccess?.();
        } else {
          writeOutbox(
            readOutbox().map((x) =>
              x.id === e.id
                ? { ...x, status: "error", attempts: x.attempts + 1, error: res.error }
                : x,
            ),
          );
        }
      } catch (err) {
        devError("outbox", "ошибка отправки:", err);
        writeOutbox(
          readOutbox().map((x) =>
            x.id === e.id
              ? { ...x, status: "error", attempts: x.attempts + 1, error: String(err) }
              : x,
          ),
        );
      }
      refresh();
    }
  }, [kind, submit, onSuccess, refresh]);

  const add = useCallback(
    (payload: T, label: string) => {
      const entry: OutboxEntry = {
        id: crypto.randomUUID(),
        kind,
        payload,
        label,
        createdAt: Date.now(),
        attempts: 0,
        status: "pending",
      };
      writeOutbox([...readOutbox(), entry]);
      refresh();
      void flush();
    },
    [kind, refresh, flush],
  );

  const remove = useCallback(
    (id: string) => {
      writeOutbox(readOutbox().filter((x) => x.id !== id));
      refresh();
    },
    [refresh],
  );

  useEffect(() => {
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const t = setInterval(() => {
      if (readOutbox().some((x) => x.kind === kind && x.status === "error")) {
        void flush();
      }
    }, 15000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(t);
    };
  }, [flush, kind]);

  return { entries, pendingCount: entries.length, add, remove, flush };
}
