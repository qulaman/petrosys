"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BUILD_SHA, buildLabel } from "@/lib/build-info";
import { ru } from "@/lib/i18n/ru";
import { cn } from "@/lib/utils";

/** Как часто спрашивать сервер о свежей сборке. */
const CHECK_MS = 10 * 60 * 1000;

/**
 * Перезагрузка с чисткой кешей. Service worker'а в проекте нет, но чистка
 * оставлена намеренно: как только он появится, «Обновить» обязано забирать
 * новый код, а не крутить старый из кеша.
 */
async function hardReload() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    toast.error("Нет связи — обновление недоступно", {
      description: "Записи из очереди не потеряются, обновитесь при связи.",
    });
    return;
  }
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Чистка не критична: перезагрузка нужна в любом случае.
  }
  // Очередь неотправленных записей живёт в localStorage и перезагрузку переживёт.
  window.location.reload();
}

/**
 * Есть ли на сервере сборка новее той, что загружена в браузере. Проверяем при
 * открытии, при возврате к приложению (полевой телефон сворачивают на весь
 * день) и раз в десять минут.
 */
function useNewerBuild(): boolean {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      // Офлайн — молча ждём связи, ругаться на это заправщику незачем.
      if (navigator.onLine === false) return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const sha = (data as { sha?: unknown }).sha;
        if (alive && typeof sha === "string") setLatest(sha);
      } catch {
        // Связь пропала посреди проверки — не наше дело.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    const timer = setInterval(() => void check(), CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);

  return latest !== null && latest !== BUILD_SHA;
}

/**
 * Версия сборки и кнопка обновления. Стоит внизу рабочих экранов и на входе:
 * по этой строке заказчик называет версию, а кнопка снимает вопрос «закрой
 * приложение и открой заново», который в поле никто не делает.
 */
export function BuildBadge({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={cn("flex flex-col items-center gap-1 text-xs text-muted-foreground", className)}>
      <p>
        версия <span className="tabular-nums">{buildLabel()}</span>
      </p>
      <Button
        variant="ghost"
        size="field"
        className="font-normal text-muted-foreground"
        loading={busy}
        onClick={() => {
          setBusy(true);
          void hardReload();
        }}
      >
        <RefreshCw className="size-4" /> Обновить
      </Button>
      <p className="text-center leading-snug">
        {ru.app.owner}
        <br />
        {ru.app.copyright}
      </p>
    </div>
  );
}

/**
 * Полоса «вышло обновление». Появляется сама, когда на сервере сборка новее
 * загруженной: PWA живёт в памяти сутками, и без такой полосы поле неделями
 * работает по старому коду, а мы разбираем «не работает» на давно исправленном.
 */
export function UpdateBanner() {
  const stale = useNewerBuild();
  const [busy, setBusy] = useState(false);
  if (!stale) return null;
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
    >
      <RefreshCw className="size-5 shrink-0 text-warning" />
      <span className="font-medium">Вышла новая версия программы</span>
      <Button
        size="field"
        className="ml-auto"
        loading={busy}
        onClick={() => {
          setBusy(true);
          void hardReload();
        }}
      >
        Обновить
      </Button>
    </div>
  );
}
