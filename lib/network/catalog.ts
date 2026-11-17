import type { DeviceKind } from "@/lib/network/model";

// Gerätebibliothek: häufige Geräte in kleinen und mittleren Betrieben. Portbezeichnungen sind Vorschläge –
// im Gerät lassen sie sich frei überschreiben. Hersteller- und Modellnamen dienen nur der Beschreibung.

export type CatalogEntry = {
  id: string;
  vendor: string;
  model: string;
  kind: DeviceKind;
  ports?: string[];
  /** Kurzinfo für die Auswahl, z. B. „24 × 1G PoE+, 2 × SFP“ */
  info?: string;
};

const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
const switchPorts = (count: number, sfp = 0, sfpName = "SFP") => [...range("", 1, count), ...range(`${sfpName} `, 1, sfp)];

export const CATALOG: CatalogEntry[] = [
  // Ubiquiti UniFi
  {
    id: "unifi-udm-pro",
    vendor: "Ubiquiti UniFi",
    model: "Dream Machine Pro",
    kind: "firewall",
    ports: ["WAN 1", "WAN 2 (SFP+)", ...range("LAN ", 1, 8), "LAN SFP+"],
    info: "Gateway + Controller, 8 × LAN",
  },
  {
    id: "unifi-ucg-ultra",
    vendor: "Ubiquiti UniFi",
    model: "Cloud Gateway Ultra",
    kind: "firewall",
    ports: ["WAN", ...range("LAN ", 1, 4)],
    info: "Gateway für kleine Netze",
  },
  {
    id: "unifi-usw-lite-8-poe",
    vendor: "Ubiquiti UniFi",
    model: "Switch Lite 8 PoE",
    kind: "switch",
    ports: switchPorts(8),
    info: "8 × 1G, 4 × PoE+",
  },
  {
    id: "unifi-usw-24-poe",
    vendor: "Ubiquiti UniFi",
    model: "Switch 24 PoE",
    kind: "switch",
    ports: switchPorts(24, 2),
    info: "24 × 1G PoE+, 2 × SFP",
  },
  {
    id: "unifi-usw-pro-24",
    vendor: "Ubiquiti UniFi",
    model: "Switch Pro 24",
    kind: "switch",
    ports: switchPorts(24, 2, "SFP+"),
    info: "24 × 1G, 2 × SFP+",
  },
  {
    id: "unifi-usw-pro-48-poe",
    vendor: "Ubiquiti UniFi",
    model: "Switch Pro 48 PoE",
    kind: "switch",
    ports: switchPorts(48, 4, "SFP+"),
    info: "48 × 1G PoE+, 4 × SFP+",
  },
  { id: "unifi-u6-pro", vendor: "Ubiquiti UniFi", model: "U6 Pro", kind: "ap", ports: ["LAN (PoE)"], info: "WiFi 6 Access Point" },
  { id: "unifi-u7-pro", vendor: "Ubiquiti UniFi", model: "U7 Pro", kind: "ap", ports: ["LAN (PoE)"], info: "WiFi 7 Access Point" },
  { id: "unifi-u6-mesh", vendor: "Ubiquiti UniFi", model: "U6 Mesh", kind: "ap", ports: ["LAN (PoE)"], info: "Outdoor/Mesh" },
  // Securepoint
  {
    id: "securepoint-black-dwarf",
    vendor: "Securepoint",
    model: "Black Dwarf",
    kind: "firewall",
    ports: range("eth", 0, 3),
    info: "UTM für kleine Büros",
  },
  { id: "securepoint-rc100", vendor: "Securepoint", model: "RC100", kind: "firewall", ports: range("eth", 0, 3), info: "UTM-Appliance" },
  { id: "securepoint-rc200", vendor: "Securepoint", model: "RC200", kind: "firewall", ports: range("eth", 0, 5), info: "UTM-Appliance" },
  { id: "securepoint-rc300", vendor: "Securepoint", model: "RC300", kind: "firewall", ports: range("eth", 0, 7), info: "UTM-Appliance" },
  { id: "securepoint-rc400", vendor: "Securepoint", model: "RC400", kind: "firewall", ports: range("eth", 0, 7), info: "UTM-Appliance" },
  // HPE / Aruba / HP
  {
    id: "aruba-1930-24g-poe",
    vendor: "HPE Aruba",
    model: "Instant On 1930 24G PoE",
    kind: "switch",
    ports: switchPorts(24, 4, "SFP+"),
    info: "24 × 1G PoE+, 4 × SFP+",
  },
  {
    id: "aruba-2930f-24g-poe",
    vendor: "HPE Aruba",
    model: "2930F 24G PoE+",
    kind: "switch",
    ports: switchPorts(24, 4, "SFP+"),
    info: "24 × 1G PoE+, 4 × SFP+",
  },
  {
    id: "aruba-2930f-48g-poe",
    vendor: "HPE Aruba",
    model: "2930F 48G PoE+",
    kind: "switch",
    ports: switchPorts(48, 4, "SFP+"),
    info: "48 × 1G PoE+, 4 × SFP+",
  },
  { id: "aruba-ap22", vendor: "HPE Aruba", model: "Instant On AP22", kind: "ap", ports: ["LAN (PoE)"] },
  { id: "hpe-dl20", vendor: "HPE", model: "ProLiant DL20", kind: "server", ports: ["LAN 1", "LAN 2", "iLO"] },
  { id: "hpe-ml30", vendor: "HPE", model: "ProLiant ML30", kind: "server", ports: ["LAN 1", "LAN 2", "iLO"] },
  { id: "hpe-dl360", vendor: "HPE", model: "ProLiant DL360", kind: "server", ports: ["LAN 1", "LAN 2", "LAN 3", "LAN 4", "iLO"] },
  { id: "hpe-dl380", vendor: "HPE", model: "ProLiant DL380", kind: "server", ports: ["LAN 1", "LAN 2", "LAN 3", "LAN 4", "iLO"] },
  { id: "hp-elitebook", vendor: "HP", model: "EliteBook", kind: "notebook" },
  { id: "hp-probook", vendor: "HP", model: "ProBook", kind: "notebook" },
  { id: "hp-elitedesk", vendor: "HP", model: "EliteDesk Mini", kind: "client" },
  { id: "hp-prodesk", vendor: "HP", model: "ProDesk", kind: "client" },
  { id: "hp-laserjet", vendor: "HP", model: "LaserJet", kind: "drucker" },
  // Wortmann TERRA
  { id: "terra-server-tower", vendor: "TERRA (Wortmann)", model: "TERRA SERVER Tower", kind: "server", ports: ["LAN 1", "LAN 2", "IPMI"] },
  {
    id: "terra-server-rack",
    vendor: "TERRA (Wortmann)",
    model: "TERRA SERVER Rack",
    kind: "server",
    ports: ["LAN 1", "LAN 2", "LAN 3", "LAN 4", "IPMI"],
  },
  { id: "terra-pc-business", vendor: "TERRA (Wortmann)", model: "TERRA PC-BUSINESS", kind: "client" },
  { id: "terra-pc-micro", vendor: "TERRA (Wortmann)", model: "TERRA PC-Micro", kind: "client" },
  { id: "terra-mobile", vendor: "TERRA (Wortmann)", model: "TERRA MOBILE", kind: "notebook" },
  // Lenovo
  { id: "lenovo-thinkpad", vendor: "Lenovo", model: "ThinkPad", kind: "notebook" },
  { id: "lenovo-thinkcentre", vendor: "Lenovo", model: "ThinkCentre", kind: "client" },
  { id: "lenovo-thinkcentre-tiny", vendor: "Lenovo", model: "ThinkCentre Tiny", kind: "client" },
  { id: "lenovo-thinksystem-st", vendor: "Lenovo", model: "ThinkSystem ST", kind: "server", ports: ["LAN 1", "LAN 2", "XCC"] },
  {
    id: "lenovo-thinksystem-sr",
    vendor: "Lenovo",
    model: "ThinkSystem SR",
    kind: "server",
    ports: ["LAN 1", "LAN 2", "LAN 3", "LAN 4", "XCC"],
  },
  // Weitere häufige Geräte
  {
    id: "avm-fritzbox",
    vendor: "AVM",
    model: "FRITZ!Box",
    kind: "router",
    ports: ["WAN", "LAN 1", "LAN 2", "LAN 3", "LAN 4"],
    info: "Provider-/Modemrouter",
  },
  { id: "provider-modem", vendor: "Provider", model: "Modem / Router", kind: "router", ports: ["WAN", "LAN 1", "LAN 2", "LAN 3", "LAN 4"] },
  { id: "lancom-1900", vendor: "LANCOM", model: "1900EF", kind: "router", ports: ["WAN", ...range("ETH ", 1, 4)] },
  { id: "synology-ds", vendor: "Synology", model: "DiskStation", kind: "nas", ports: ["LAN 1", "LAN 2"] },
  { id: "synology-rs", vendor: "Synology", model: "RackStation", kind: "nas", ports: ["LAN 1", "LAN 2", "LAN 3", "LAN 4"] },
  { id: "qnap-ts", vendor: "QNAP", model: "TS-Serie", kind: "nas", ports: ["LAN 1", "LAN 2"] },
  { id: "apc-smart-ups", vendor: "APC", model: "Smart-UPS", kind: "usv", ports: ["Netzwerkkarte"] },
  { id: "kyocera-ecosys", vendor: "Kyocera", model: "ECOSYS", kind: "drucker" },
  { id: "brother-mfc", vendor: "Brother", model: "MFC", kind: "drucker" },
  { id: "yealink-t5", vendor: "Yealink", model: "T5-Serie", kind: "telefon", ports: ["LAN", "PC"] },
  { id: "unifi-g5-bullet", vendor: "Ubiquiti UniFi", model: "G5 Bullet", kind: "kamera", ports: ["LAN (PoE)"] },
];

export function findCatalog(id: string | undefined): CatalogEntry | undefined {
  return id ? CATALOG.find((entry) => entry.id === id) : undefined;
}

/** Suche in der Bibliothek: „unifi 24“, „securepoint“, „terra server“ … */
export function searchCatalog(query: string): CatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return CATALOG;
  return CATALOG.filter((entry) => {
    const haystack = `${entry.vendor} ${entry.model} ${entry.info ?? ""} ${entry.kind}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
