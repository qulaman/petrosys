"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Глобальная кнопка «Назад» в заголовке экрана (PWA не имеет браузерной).
 * На корневых экранах разделов (пункты меню) не показывается. Возврат — через
 * историю (сохраняет вкладку/период/фильтры откуда пришли); если внутренних
 * переходов ещё не было (прямая ссылка, свежий запуск) — на родителя маршрута.
 */

// Корневые экраны разделов — совпадают с пунктами меню и домашними экранами ролей.
const ROOTS = new Set([
  "/", "/login", "/no-access",
  "/portal", "/portal/trips", "/portal/shifts", "/portal/fuel", "/portal/documents",
  "/fleet/dashboard", "/fleet/fuel/issue", "/fleet/fuel/tanker",
  "/fleet/shifts", "/fleet/volume", "/fleet/trips", "/fleet/journals",
  "/fleet/office/settlement", "/fleet/office/documents", "/fleet/admin",
]);

// Счётчик внутренних SPA-переходов: живёт в рантайме вкладки, сбрасывается
// при полной перезагрузке — тогда «назад» ведёт на родителя, а не из приложения.
let navCount = 0;

function parentOf(path: string): string {
  let p = path;
  while (p.includes("/")) {
    p = p.slice(0, p.lastIndexOf("/"));
    if (ROOTS.has(p)) return p;
    if (p === "/fleet" || p === "") return "/";
  }
  return "/";
}

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    navCount += 1;
  }, [pathname]);

  if (ROOTS.has(pathname)) return null;

  function goBack() {
    if (navCount > 1) router.back();
    else router.push(parentOf(pathname));
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="-ml-2 size-10 shrink-0"
      aria-label="Назад"
      onClick={goBack}
    >
      <ArrowLeft className="size-5" />
    </Button>
  );
}
