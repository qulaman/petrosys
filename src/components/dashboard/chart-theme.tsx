/**
 * Общее оформление графиков дашборда (recharts).
 * Раньше эти константы были скопированы в каждой вкладке и успели
 * разъехаться по размеру шрифта — держим их в одном месте.
 */

export const axisTick = { fill: "var(--muted-foreground)", fontSize: 12 };

export const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 13,
};

/** Подписи легенды цветом текста, а не цветом серии (правило dataviz). */
export const legendFormatter = (v: React.ReactNode) => (
  <span style={{ color: "var(--foreground)", fontSize: 12 }}>{v}</span>
);
