"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Состояние вкладки, переживающее перерисовку и возврат по «Назад».
 *
 * Suspense на странице дашборда размонтирует поддерево при смене периода
 * (key = tab|from|to), а переход в журнал уводит со страницы целиком — обычный
 * useState в обоих случаях терялся вместе с поиском, сортировкой и прокруткой.
 *
 * Пишем через нативный history.replaceState: Next синхронизирует его с роутером
 * (docs/01-app/02-guides/single-page-applications.md), но НЕ перезапускает
 * серверный компонент — данные не перезапрашиваются на каждое нажатие клавиши.
 */
export function usePersistedState(key: string, initial: string) {
  const sp = useSearchParams();
  // Начальное значение читаем один раз: дальше источник истины — локальный state.
  const [value, setValue] = useState(() => sp.get(key) ?? initial);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (value === initial) p.delete(key);
    else p.set(key, value);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [key, value, initial]);

  return [value, setValue] as const;
}
