/**
 * Публичный API очереди неотправленных записей.
 * Реализация хранилища — IndexedDB, см. `db.ts`. Синхронного доступа больше нет:
 * localStorage вымылся вместе с ограничением в 5 МБ.
 */
export { allEntries, entriesOfKind, putEntry, deleteEntry } from "@/lib/outbox/db";
export { KIND_LABELS, type OutboxEntry, type OutboxKind, type OutboxStatus } from "@/lib/outbox/types";

/** Событие, по которому все подписчики (в т.ч. индикатор в шапке) перечитывают очередь. */
export const OUTBOX_CHANGED = "qo-outbox-changed";

export function notifyOutboxChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OUTBOX_CHANGED));
}
