// Anzeigehilfen für den Arbeitsplatz (auch in Client-Komponenten nutzbar).

const WEEKDAYS_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** „Mo 16.11.“ */
export function shortDate(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return `${WEEKDAYS_SHORT[day]} ${date.slice(8, 10)}.${date.slice(5, 7)}.`;
}

/** Fälligkeit relativ zu heute: „überfällig seit 2 Tagen“, „heute“, „morgen“, „Do 19.11.“ */
export function dueLabel(date: string, today: string): { label: string; tone: "overdue" | "today" | "soon" | "later" } {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { label: days === -1 ? "seit gestern fällig" : `seit ${-days} Tagen fällig`, tone: "overdue" };
  if (days === 0) return { label: "heute", tone: "today" };
  if (days === 1) return { label: "morgen", tone: "soon" };
  return { label: shortDate(date), tone: days <= 7 ? "soon" : "later" };
}

/** „vor 5 Min.“, „vor 3 Std.“, „vor 2 Tagen“ */
export function ago(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const time = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(time)) return "";
  const minutes = Math.max(0, Math.round((now.getTime() - time) / 60_000));
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
}

export const PRIORITY_DOT: Record<string, string> = {
  Critical: "bg-red-600",
  High: "bg-orange-500",
  Medium: "bg-amber-400",
  Low: "bg-slate-300",
  hoch: "bg-red-500",
  normal: "bg-slate-300",
  niedrig: "bg-slate-200",
};

export const SEVERITY_STYLE: Record<string, string> = {
  Critical: "bg-red-100 text-red-800",
  Warning: "bg-amber-100 text-amber-800",
  Information: "bg-sky-100 text-sky-800",
};

/** Minuten als Stunden mit Dezimalkomma: 90 → „1,5 h“, -30 → „−0,5 h“. */
export function formatHours(minutes: number): string {
  const hours = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 2 }).format(Math.abs(minutes) / 60);
  return `${minutes < 0 ? "−" : ""}${hours} h`;
}

/**
 * Dauer aus einer Eingabe in Minuten: „1,5“ oder „1.5“ (Stunden), „1:30“, „90 min“, „2 h“, „1 h 15“, „45m“.
 * null bei leerer oder ungültiger Eingabe.
 */
export function parseDuration(input: string): number | null {
  const value = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!value) return null;
  let match = value.match(/^(\d{1,3}):([0-5]\d)$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  match = value.match(/^(\d{1,4}) ?(m|min|minuten)$/);
  if (match) return Number(match[1]);
  match = value.match(/^(\d{1,3}) ?(h|std\.?|stunden?) ?(\d{1,2}) ?(m|min|minuten)?$/);
  if (match) return Number(match[1]) * 60 + Number(match[3]);
  match = value.match(/^(\d{1,3}(?:[.,]\d{1,2})?) ?(h|std\.?|stunden?)?$/);
  if (match) return Math.round(Number(match[1].replace(",", ".")) * 60);
  return null;
}

/** Darstellung des Reststands eines Stundenkontos. */
export const BALANCE_STYLE: Record<"ok" | "knapp" | "ueberzogen" | "kein_paket", { label: string; className: string }> = {
  ok: { label: "", className: "text-emerald-700" },
  knapp: { label: "knapp", className: "text-amber-600" },
  ueberzogen: { label: "überzogen", className: "text-red-600" },
  kein_paket: { label: "kein Paket", className: "text-slate-400" },
};
