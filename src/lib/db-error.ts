/**
 * Ошибки Postgres/PostgREST/Storage → человеческий русский текст.
 *
 * Сырой `error.message` английский и раскрывает наружу структуру БД (имена таблиц,
 * ограничений, политик), поэтому пользователю он не показывается никогда.
 * Подробности уходят в консоль разработчика через devError; в dev-режиме
 * оригинал дополнительно приписывается к тексту, чтобы отлаживать без консоли.
 */
import { devError, IS_DEV } from "@/lib/dev-log";

/** Общая форма ошибки Supabase: и PostgrestError, и StorageError сводятся к ней. */
export interface DbErrorLike {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** Коды Postgres и PostgREST, для которых есть внятное объяснение пользователю. */
const BY_CODE: Record<string, string> = {
  "23502": "Не заполнено обязательное поле",
  "23503": "Запись используется в учёте — сначала уберите связанные с ней данные",
  "23505": "Такая запись уже есть",
  "23514": "Значение не проходит проверку — проверьте заполнение полей",
  "22001": "Слишком длинное значение",
  "22003": "Число слишком большое",
  "22007": "Неверный формат даты",
  "22P02": "Неверный формат значения",
  "42501": "Недостаточно прав для этой операции",
  "40001": "Запись изменил кто-то ещё — повторите попытку",
  PGRST116: "Запись не найдена",
  PGRST301: "Сессия истекла — войдите заново",
};

/**
 * Подстроки на случай, когда кода нет: Storage и часть ошибок PostgREST
 * приходят без `code`, только с текстом.
 */
const BY_TEXT: [RegExp, string][] = [
  [/duplicate key|already exists/i, "Такая запись уже есть"],
  [/foreign key/i, "Запись используется в учёте — сначала уберите связанные с ней данные"],
  [/row-level security|permission denied/i, "Недостаточно прав для этой операции"],
  [/jwt|not authenticated|invalid token/i, "Сессия истекла — войдите заново"],
  [/payload too large|maximum allowed size|exceeded the maximum/i, "Файл слишком большой"],
  [/mime type|invalid file/i, "Неподходящий тип файла"],
  [/not found|does not exist/i, "Запись не найдена"],
  [/fetch failed|network|timeout|ETIMEDOUT|ECONNRESET/i, "Нет связи с сервером — попробуйте ещё раз"],
];

/**
 * Текст ошибки для пользователя. `scope` — метка для лога разработчика
 * (обычно имя действия), `fallback` — что показать, когда причина не распознана.
 */
export function dbError(
  scope: string,
  error: DbErrorLike | null | undefined,
  fallback = "Не удалось выполнить операцию — попробуйте ещё раз",
): string {
  if (!error) return fallback;
  devError(scope, error.code ?? "", error.message, error.details ?? "", error.hint ?? "");

  // P0001 — `raise exception` из наших триггеров, текст уже русский и осмысленный.
  if (error.code === "P0001") return error.message;

  const byCode = error.code ? BY_CODE[error.code] : undefined;
  const matched = byCode ?? BY_TEXT.find(([re]) => re.test(error.message))?.[1];
  const text = matched ?? fallback;

  return IS_DEV ? `${text} · [${error.code ?? "—"}] ${error.message}` : text;
}

/**
 * То же для неожиданных исключений (обрыв сети в server action, throw в библиотеке).
 * Сообщения JS-ошибок наружу тоже не отдаём.
 */
export function unexpectedError(
  scope: string,
  e: unknown,
  fallback = "Не удалось выполнить операцию — попробуйте ещё раз",
): string {
  const message = e instanceof Error ? e.message : String(e);
  return dbError(scope, { message }, fallback);
}
