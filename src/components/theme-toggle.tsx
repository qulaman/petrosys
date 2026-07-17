"use client";

import { useEffect, useState } from "react";
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

/**
 * Трёхпозиционный переключатель темы: авто (по времени) → светлая → тёмная.
 * Выбор сохраняется в localStorage; начальную тему ставит инлайн-скрипт в <head>.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("auto");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode) || "auto";
    setMode(stored);
    setMounted(true);
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setMode(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    apply(next);
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
      <span className="hidden sm:inline">
        {mounted ? LABEL[mode] : ru.theme.label}
      </span>
    </Button>
  );
}
