/**
 * Очередь неотправленных полевых записей. По ТЗ полноценный offline-first
 * не делаем, но потеря записи в поле недопустима: связь на карьере пропадает
 * регулярно, а подпись водителя на выдачу топлива юридически значима.
 */
export type OutboxStatus = "pending" | "sending" | "error";

/** Типы записей, которые умеют становиться в очередь. */
export type OutboxKind = "trip" | "fuel_issue" | "shift_hours" | "tanker";

export interface OutboxEntry {
  /** Локальный uuid — он же ключ в хранилище. */
  id: string;
  kind: OutboxKind | string;
  /** Полезная нагрузка; может содержать Blob (фото чека) — IndexedDB хранит как есть. */
  payload: unknown;
  /** Подпись для ленты («353 FJ 04 · 14:22»). */
  label: string;
  createdAt: number;
  attempts: number;
  status: OutboxStatus;
  error?: string;
}

/** Человеческое название типа записи — для общего индикатора в шапке. */
export const KIND_LABELS: Record<string, string> = {
  trip: "рейсы",
  fuel_issue: "выдачи топлива",
  shift_hours: "часы в табеле",
  tanker: "операции бензовоза",
};
