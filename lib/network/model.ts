import { z } from "zod";

// Netzwerkdokumentation eines Kunden: Internetanschluss (WAN), Netze/VLANs, Geräte und Verbindungen.

export const DEVICE_KINDS = {
  firewall: "Firewall",
  router: "Router / Modem",
  switch: "Switch",
  ap: "WLAN-Access-Point",
  server: "Server",
  nas: "NAS / Storage",
  client: "PC",
  notebook: "Notebook",
  drucker: "Drucker",
  telefon: "Telefon",
  kamera: "Kamera",
  usv: "USV",
  sonstiges: "Sonstiges",
} as const;
export type DeviceKind = keyof typeof DEVICE_KINDS;

export const MEDIA = { kupfer: "Kupfer (LAN)", glasfaser: "Glasfaser", wlan: "WLAN", vpn: "VPN" } as const;
export type Medium = keyof typeof MEDIA;

const text = (max = 200) => z.string().trim().max(max).optional().catch(undefined);

export const NetDeviceSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  kind: z.enum(Object.keys(DEVICE_KINDS) as [DeviceKind, ...DeviceKind[]]).catch("sonstiges"),
  vendor: text(),
  model: text(),
  catalogId: text(64),
  ip: text(45),
  mac: text(32),
  networkId: text(64),
  location: text(),
  serial: text(100),
  notes: text(2000),
  ports: z.array(z.string().max(40)).max(128).optional().catch(undefined),
});

export const NetLinkSchema = z.object({
  id: z.string().min(1).max(64),
  from: z.string().min(1).max(64),
  fromPort: text(40),
  to: z.string().min(1).max(64),
  toPort: text(40),
  medium: z.enum(Object.keys(MEDIA) as [Medium, ...Medium[]]).catch("kupfer"),
  untagged: text(64),
  tagged: z.array(z.string().max(64)).max(64).optional().catch(undefined),
  notes: text(500),
});

export const NetNetworkSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(60),
  vlan: z.coerce.number().int().catch(1),
  subnet: z.string().trim().max(45).catch(""),
  gateway: text(45),
  dhcp: z
    .object({ enabled: z.boolean().catch(false), start: text(45), end: text(45) })
    .optional()
    .catch(undefined),
  dns: text(200),
  notes: text(500),
});

export const WanSchema = z.object({
  mode: z.enum(["statisch", "dhcp", "pppoe"]).catch("dhcp"),
  ip: text(45),
  prefix: z.coerce.number().int().min(0).max(32).optional().catch(undefined),
  gateway: text(45),
  dns: text(200),
  firewallId: text(64),
  upstreamSubnet: text(45),
  provider: text(100),
});

export const NetworkModelSchema = z.object({
  version: z.literal(1).catch(1),
  wan: WanSchema.catch({ mode: "dhcp" }),
  networks: z.array(NetNetworkSchema).max(200).catch([]),
  devices: z.array(NetDeviceSchema).max(2000).catch([]),
  links: z.array(NetLinkSchema).max(5000).catch([]),
});

export type NetDevice = z.infer<typeof NetDeviceSchema>;
export type NetLink = z.infer<typeof NetLinkSchema>;
export type NetNetwork = z.infer<typeof NetNetworkSchema>;
export type WanConfig = z.infer<typeof WanSchema>;
export type NetworkModel = z.infer<typeof NetworkModelSchema>;

export const emptyModel = (): NetworkModel => ({ version: 1, wan: { mode: "dhcp" }, networks: [], devices: [], links: [] });

/** Kurze, lesbare IDs für neue Einträge. */
export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Netze, die eine Verbindung trägt (untagged plus tagged). */
export function linkNetworks(link: NetLink): Set<string> {
  return new Set([link.untagged, ...(link.tagged ?? [])].filter((id): id is string => Boolean(id)));
}
