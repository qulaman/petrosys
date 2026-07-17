/**
 * Локальная очередь неотправленных полевых записей (retry-outbox).
 * Хранится в localStorage — записи в поле не теряются при обрыве сети.
 * По ТЗ полноценный offline-first не делаем, но потеря записи недопустима.
 */
export type OutboxStatus = "pending" | "sending" | "error";

export interface OutboxEntry {
  id: string; // локальный uuid
  kind: string; // тип записи: "trip", "shift", "fuel_issue"…
  payload: unknown;
  label: string; // подпись для ленты («353 FJ 04 · 14:22»)
  createdAt: number;
  attempts: number;
  status: OutboxStatus;
  error?: string;
}

const KEY = "qo-outbox";

export function readOutbox(): OutboxEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as OutboxEntry[];
  } catch {
    return [];
  }
}

export function writeOutbox(list: OutboxEntry[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
}
