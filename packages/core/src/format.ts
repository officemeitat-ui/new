export const DEFAULT_LOCALE = "de-AT";
export const DEFAULT_TIME_ZONE = "Europe/Vienna";

export function formatCurrency(amount: number, currency = "EUR", locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}

export function formatNumber(
  value: number,
  locale = DEFAULT_LOCALE,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatDate(
  date: Date | string | number,
  locale = DEFAULT_LOCALE,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(new Date(date));
}

export function formatDateTime(
  date: Date | string | number,
  locale = DEFAULT_LOCALE,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(date));
}

/** "Dienstag, 10.11.2026" – the format agents use when proposing appointments. */
export function formatDateWithWeekday(
  date: Date | string | number,
  locale = DEFAULT_LOCALE,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const d = new Date(date);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone }).format(d);
  return `${weekday}, ${formatDate(d, locale, timeZone)}`;
}

/** Hour of the day (0–23) in the given time zone, e.g. for greetings and business hours. */
export function hourInTimeZone(date: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): number {
  const part = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone,
  })
    .formatToParts(date)
    .find((p) => p.type === "hour");
  return Number(part?.value ?? 0);
}

export type DayPeriod = "morning" | "day" | "evening";

export function dayPeriod(date: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): DayPeriod {
  const hour = hourInTimeZone(date, timeZone);
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 18) return "day";
  return "evening";
}
