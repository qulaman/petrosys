/** Форматирование чисел/дат для интерфейса. Часовой пояс объекта — Asia/Aqtobe (UTC+5). */

export const TIME_ZONE = "Asia/Aqtobe";

const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

export function fmtLiters(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${nf1.format(v)} л`;
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null) return "—";
  return nf0.format(v);
}

export function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${nf0.format(v)} ₸`;
}

const dtf = new Intl.DateTimeFormat("ru-RU", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const tf = new Intl.DateTimeFormat("ru-RU", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dtf.format(new Date(iso));
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return tf.format(new Date(iso));
}
