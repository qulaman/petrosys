"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

interface NavProgress {
  pending: boolean;
  push: (url: string) => void;
  replace: (url: string) => void;
  refresh: () => void;
}

const Ctx = createContext<NavProgress | null>(null);

/**
 * Программная навигация с обратной связью: любой push/refresh через этот
 * контекст показывает тонкий прогресс-бар вверху экрана, пока сервер
 * рендерит страницу. Для <Link> есть useLinkStatus (см. nav-bar).
 */
export function NavProgressProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const push = useCallback((url: string) => start(() => router.push(url)), [router]);
  const replace = useCallback((url: string) => start(() => router.replace(url)), [router]);
  const refresh = useCallback(() => start(() => router.refresh()), [router]);

  const value = useMemo(
    () => ({ pending, push, replace, refresh }),
    [pending, push, replace, refresh],
  );

  return (
    <Ctx.Provider value={value}>
      {pending ? (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-nav-progress rounded-full bg-primary" />
        </div>
      ) : null}
      {children}
    </Ctx.Provider>
  );
}

export function useNavProgress(): NavProgress {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNavProgress: нет NavProgressProvider в дереве");
  return ctx;
}
