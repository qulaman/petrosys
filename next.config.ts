import type { NextConfig } from "next";

/**
 * Метка сборки инлайнится и в серверный код, и в клиентский бандл. Полевой
 * телефон работает установленной PWA и держит страницу в памяти сутками:
 * без метки на «не работает» невозможно ответить, какой код на нём запущен,
 * а по расхождению метки в бандле и на сервере видно, что вышло обновление.
 */
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "локальная",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
