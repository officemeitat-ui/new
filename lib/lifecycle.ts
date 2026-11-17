// Support-Ende von Betriebssystemen und Server-Software (Herstellerangaben Microsoft) – aus dem ME-IT Cockpit.
// Grundlage für Warnungen im Inventar und für das Umsatz-Radar.

export type EolEntry = { pattern: RegExp; end: string; label: string; server: boolean };

export const EOL_TABLE: EolEntry[] = [
  { pattern: /windows server 2008/i, end: "2020-01-14", label: "Windows Server 2008", server: true },
  { pattern: /windows server 2012/i, end: "2023-10-10", label: "Windows Server 2012/R2", server: true },
  { pattern: /windows server 2016/i, end: "2027-01-12", label: "Windows Server 2016", server: true },
  { pattern: /windows server 2019/i, end: "2029-01-09", label: "Windows Server 2019", server: true },
  { pattern: /windows 7\b/i, end: "2020-01-14", label: "Windows 7", server: false },
  { pattern: /windows 8(\.1)?\b/i, end: "2023-01-10", label: "Windows 8.1", server: false },
  { pattern: /windows 10\b/i, end: "2025-10-14", label: "Windows 10", server: false },
  { pattern: /exchange (server )?2016/i, end: "2025-10-14", label: "Exchange Server 2016", server: true },
  { pattern: /exchange (server )?2019/i, end: "2025-10-14", label: "Exchange Server 2019", server: true },
  { pattern: /office 2016/i, end: "2025-10-14", label: "Office 2016", server: false },
  { pattern: /office 2019/i, end: "2025-10-14", label: "Office 2019", server: false },
];

export type EolStatus = { label: string; end: string; state: "abgelaufen" | "bald" | "ok"; server: boolean };

/** Support-Status zu einer Betriebssystem-Angabe wie „Windows 10 Pro 22H2“. „bald“ = innerhalb von 18 Monaten. */
export function eolStatus(os: string | null | undefined, today: string): EolStatus | null {
  if (!os) return null;
  const entry = EOL_TABLE.find((e) => e.pattern.test(os));
  if (!entry) return null;
  const soon = new Date(`${today}T12:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 548);
  const state = entry.end <= today ? "abgelaufen" : entry.end <= soon.toISOString().slice(0, 10) ? "bald" : "ok";
  return { label: entry.label, end: entry.end, state, server: entry.server };
}
