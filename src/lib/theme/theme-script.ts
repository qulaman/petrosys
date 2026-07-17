/**
 * Значения режима темы, хранимые в localStorage.
 * auto — по времени суток (ночная смена 22:00–06:00 → тёмная).
 */
export const THEME_STORAGE_KEY = "qo-theme";
export type ThemeMode = "auto" | "light" | "dark";

/**
 * Инлайн-скрипт для <head>: применяет тему ДО первой отрисовки (без мигания).
 * Выполняется синхронно, поэтому здесь обычный JS-строкой.
 */
export const themeInitScript = `
(function () {
  try {
    var key = "${THEME_STORAGE_KEY}";
    var mode = localStorage.getItem(key) || "auto";
    var isDark;
    if (mode === "dark") isDark = true;
    else if (mode === "light") isDark = false;
    else {
      var h = new Date().getHours();
      isDark = h >= 22 || h < 6;
    }
    document.documentElement.classList.toggle("dark", isDark);
  } catch (e) {}
})();
`;

/** Чистая функция расчёта: тёмная ли тема для режима на данный час. */
export function resolveIsDark(mode: ThemeMode, hour: number): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return hour >= 22 || hour < 6;
}
