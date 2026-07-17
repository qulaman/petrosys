/** Дата (yyyy-mm-dd) из timestamptz в поясе объекта Asia/Aqtobe. */
export function aqtobeDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Aqtobe",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
