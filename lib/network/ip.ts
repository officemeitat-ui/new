// IPv4-Rechnen für die Netzwerkprüfung (läuft im Browser und auf dem Server).

export type Cidr = { network: number; prefix: number; mask: number };

/** „192.168.10.1“ → Zahl; null bei ungültiger Eingabe. */
export function parseIp(value: string | null | undefined): number | null {
  const match = (value ?? "").trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((p) => p > 255) || match.slice(1).some((p) => p.length > 1 && p.startsWith("0"))) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function formatIp(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

export function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** „192.168.20.0/24“ → Netz; hostBits = true, wenn Hostbits gesetzt waren („192.168.20.5/24“). */
export function parseCidr(value: string | null | undefined): (Cidr & { hostBits: boolean; given: number }) | null {
  const match = (value ?? "").trim().match(/^([\d.]+)\/(\d{1,2})$/);
  if (!match) return null;
  const ip = parseIp(match[1]);
  const prefix = Number(match[2]);
  if (ip === null || prefix > 32) return null;
  const mask = maskOf(prefix);
  const network = (ip & mask) >>> 0;
  return { network, prefix, mask, hostBits: network !== ip, given: ip };
}

export const cidrText = (c: Cidr) => `${formatIp(c.network)}/${c.prefix}`;
export const broadcastOf = (c: Cidr) => (c.network | (~c.mask >>> 0)) >>> 0;
export const contains = (c: Cidr, ip: number) => (ip & c.mask) >>> 0 === c.network;
export const overlaps = (a: Cidr, b: Cidr) => contains(a, b.network) || contains(b, a.network);

/** Anzahl nutzbarer Adressen (ohne Netz- und Broadcast-Adresse; /31 und /32 als Sonderfälle). */
export function usableHosts(c: Cidr): number {
  if (c.prefix >= 31) return c.prefix === 31 ? 2 : 1;
  return 2 ** (32 - c.prefix) - 2;
}

export const isNetworkOrBroadcast = (c: Cidr, ip: number) => c.prefix < 31 && (ip === c.network || ip === broadcastOf(c));

const PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map((c) => parseCidr(c)!);
const CGNAT = parseCidr("100.64.0.0/10")!;
const SPECIAL = ["0.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/4", "240.0.0.0/4"].map((c) => parseCidr(c)!);

export function ipClass(ip: number): "privat" | "cgnat" | "speziell" | "oeffentlich" {
  if (PRIVATE.some((c) => contains(c, ip))) return "privat";
  if (contains(CGNAT, ip)) return "cgnat";
  if (SPECIAL.some((c) => contains(c, ip))) return "speziell";
  return "oeffentlich";
}

/** Prefixlänge aus „/24“, „24“ oder „255.255.255.0“. */
export function parsePrefix(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 32 ? value : null;
  const text = (value ?? "").trim().replace(/^\//, "");
  if (/^\d{1,2}$/.test(text)) return Number(text) <= 32 ? Number(text) : null;
  const mask = parseIp(text);
  if (mask === null) return null;
  for (let prefix = 0; prefix <= 32; prefix++) if (maskOf(prefix) === mask) return prefix;
  return null;
}
