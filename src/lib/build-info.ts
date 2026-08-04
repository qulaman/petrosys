import { fmtDateTime } from "@/lib/format";

/**
 * Метка сборки. Значения инлайнятся при сборке (см. `env` в next.config.ts),
 * поэтому одинаково доступны серверу и браузеру: сервер отдаёт свою метку по
 * `/api/version`, браузер сравнивает её с той, что зашита в загруженный бандл.
 */
export const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? "локальная";
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";

/**
 * Человеческая версия сборки: «04.08.2026, 14:20 · 9f1f848». Дата — в поясе
 * объекта, её называют вслух по телефону; хеш нужен уже нам, чтобы найти
 * коммит.
 */
export function buildLabel(): string {
  return BUILD_TIME ? `${fmtDateTime(BUILD_TIME)} · ${BUILD_SHA}` : BUILD_SHA;
}
