"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { devError } from "@/lib/dev-log";
import {
  allEntries, deleteEntry, entriesOfKind, notifyOutboxChanged, putEntry,
  OUTBOX_CHANGED, type OutboxEntry,
} from "@/lib/outbox/outbox";

export type SubmitResult = { ok: true } | { ok: false; error: string };

/** Досылка идёт по одной за раз на весь документ — иначе запись уходит дважды. */
let flushing = false;

/**
 * Retry-очередь для одного типа записей. add() кладёт запись в хранилище и
 * сразу пробует отправить; при обрыве связи запись остаётся, счётчик виден,
 * досылка — при возврате сети и по таймеру, с тостом об успехе.
 */
export function useOutbox<T>(
  kind: string,
  submit: (payload: T) => Promise<SubmitResult>,
  onSuccess?: () => void,
) {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  // Свежие ссылки в интервале и слушателях — без пересоздания таймера на каждый рендер.
  const submitRef = useRef(submit);
  const successRef = useRef(onSuccess);
  useEffect(() => {
    submitRef.current = submit;
    successRef.current = onSuccess;
  });

  const refresh = useCallback(async () => {
    setEntries(await entriesOfKind(kind));
  }, [kind]);

  useEffect(() => {
    const onChange = () => void refresh();
    window.addEventListener(OUTBOX_CHANGED, onChange);
    // Первое чтение — асинхронно (rAF): синхронный setState в теле эффекта
    // запрещён линтом и правда даёт лишний каскад рендеров.
    const raf = requestAnimationFrame(onChange);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener(OUTBOX_CHANGED, onChange);
    };
  }, [refresh]);

  const flush = useCallback(async () => {
    if (flushing) return;
    flushing = true;
    let sent = 0;
    try {
      const targets = (await entriesOfKind(kind)).filter((e) => e.status !== "sending");
      for (const e of targets) {
        await putEntry({ ...e, status: "sending" });
        notifyOutboxChanged();
        try {
          const res = await submitRef.current(e.payload as T);
          if (res.ok) {
            await deleteEntry(e.id);
            // Считаем только те, что раньше не смогли уйти: обычная отправка
            // подтверждается самим экраном, лишний тост на ней только мешает.
            if (e.attempts > 0) sent += 1;
            successRef.current?.();
          } else {
            await putEntry({ ...e, status: "error", attempts: e.attempts + 1, error: res.error });
          }
        } catch (err) {
          devError("outbox", "ошибка отправки:", err);
          await putEntry({
            ...e,
            status: "error",
            attempts: e.attempts + 1,
            error: "Нет связи с сервером",
          });
        }
        notifyOutboxChanged();
      }
    } finally {
      flushing = false;
    }
    // Молчаливая досылка пугает: человек не знает, ушла запись или нет.
    if (sent > 0) {
      toast.success(sent === 1 ? "Отложенная запись отправлена" : `Отправлено записей: ${sent}`);
    }
    await refresh();
  }, [kind, refresh]);

  /**
   * `id` задаётся, когда повторная правка одного и того же должна заменять
   * предыдущую, а не добавлять вторую запись (часы в табеле: побеждает последнее
   * введённое значение). Без него — обычная новая запись в очереди.
   */
  const add = useCallback(
    async (payload: T, label: string, id?: string) => {
      await putEntry({
        id: id ?? crypto.randomUUID(),
        kind,
        payload,
        label,
        createdAt: Date.now(),
        attempts: 0,
        status: "pending",
      });
      notifyOutboxChanged();
      await refresh();
      void flush();
    },
    [kind, refresh, flush],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteEntry(id);
      notifyOutboxChanged();
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const t = setInterval(async () => {
      if (!navigator.onLine) return;
      const stuck = (await allEntries()).some((x) => x.kind === kind && x.status === "error");
      if (stuck) void flush();
    }, 15000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(t);
    };
  }, [flush, kind]);

  return { entries, pendingCount: entries.length, add, remove, flush };
}
