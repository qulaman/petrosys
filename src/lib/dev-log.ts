/**
 * Логирование для разработки. На сервере пишет в терминал `npm run dev`,
 * на клиенте — в консоль браузера. В production молчит.
 */
const isDev = process.env.NODE_ENV !== "production";

export function devLog(scope: string, ...args: unknown[]) {
  if (isDev) console.log(`[${scope}]`, ...args);
}

export function devError(scope: string, ...args: unknown[]) {
  if (isDev) console.error(`[${scope}]`, ...args);
}

/** Признак dev-режима — чтобы возвращать подробные ошибки на экран только в разработке. */
export const IS_DEV = isDev;
