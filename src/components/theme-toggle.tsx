"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, SunDim } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  THEME_STORAGE_KEY,
  resolveIsDark,
  type ThemeMode,
} from "@/lib/theme/theme-script";
import { ru } from "@/lib/i18n/ru";

const ORDER: ThemeMode[] = ["auto", "light", "dark", "sun"];
const ICON = { auto: Monitor, light: SunDim, dark: Moon, sun: Sun };
const LABEL = {
  auto: ru.theme.auto,
  light: ru.theme.light,
  dark: ru.theme.dark,
  sun: "Солнце",
};

function apply(mode: ThemeMode) {
  const isDark = resolveIsDark(mode, new Date().getHours());
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle("sun", mode === "sun");
}

// Режим темы как внешнее хранилище (localStorage) для useSyncExternalStore:
// без setState-в-эффекте и каскадного ререндера при монтировании.
const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb); // синхронизация между вкладками
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function getSnapshot(): ThemeMode {
  return (localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode) || "auto";
}
function getServerSnapshot(): ThemeMode {
  return "auto"; // на сервере выбора нет; фактическую тему ставит инлайн-скрипт в <head>
}
function setThemeMode(next: ThemeMode) {
  localStorage.setItem(THEME_STORAGE_KEY, next);
  apply(next);
  for (const cb of listeners) cb();
}

/**
 * Переключатель темы: авто (по времени) → светлая → тёмная → «солнце».
 * Выбор сохраняется в localStorage; начальную тему ставит инлайн-скрипт в <head>.
 */
export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function cycle() {
    setThemeMode(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]);
  }

  const Icon = ICON[mode];

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cycle}
      aria-label={`${ru.theme.label}: ${LABEL[mode]}`}
      title={`${ru.theme.label}: ${LABEL[mode]}`}
    >
      <Icon className="size-4" />
      <span className="hidden sm:inline">{LABEL[mode]}</span>
    </Button>
  );
}
