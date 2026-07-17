/**
 * Значения режима темы, хранимые в localStorage.
 * auto — по времени суток (ночная смена 22:00–06:00 → тёмная).
 */
export const THEME_STORAGE_KEY = "qo-theme";
/** sun — режим яркого солнца: светлая тема с максимальным контрастом. */
export type ThemeMode = "auto" | "light" | "dark" | "sun";

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
    else if (mode === "light" || mode === "sun") isDark = false;
    else {
      var h = new Date().getHours();
      isDark = h >= 22 || h < 6;
    }
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("sun", mode === "sun");
  } catch (e) {}
})();
`;

/** Чистая функция расчёта: тёмная ли тема для режима на данный час. */
export function resolveIsDark(mode: ThemeMode, hour: number): boolean {
  if (mode === "dark") return true;
  if (mode === "light" || mode === "sun") return false;
  return hour >= 22 || hour < 6;
}
