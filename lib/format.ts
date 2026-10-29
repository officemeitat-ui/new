import { site } from "@/config/site";

const euro = new Intl.NumberFormat(site.locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat(site.locale, { dateStyle: "medium", timeStyle: "short", timeZone: site.timeZone });
const date = new Intl.DateTimeFormat(site.locale, { dateStyle: "medium", timeZone: site.timeZone });

export const formatEuro = (value: number) => euro.format(value);
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => date.format(new Date(iso));
export const formatPercent = (part: number, total: number) => (total === 0 ? "–" : `${Math.round((part / total) * 100)} %`);
