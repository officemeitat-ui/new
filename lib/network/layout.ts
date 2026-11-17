import { firewallOf } from "@/lib/network/check";
import type { NetDevice, NetworkModel } from "@/lib/network/model";

// Automatische Anordnung für den Netzwerkplan: Internet oben, darunter Router/Firewall, dann Switches und Endgeräte
// in Ebenen nach Abstand zur Firewall. Geräte ohne Verbindung kommen in eine eigene Zeile unten.

export type PlacedNode = { device: NetDevice; x: number; y: number };
export type Layout = {
  nodes: PlacedNode[];
  internet: { x: number; y: number } | null;
  width: number;
  height: number;
  /** y-Position der Zeile „ohne Verbindung zur Firewall“, falls es sie gibt */
  unconnectedY: number | null;
};

export const NODE_WIDTH = 150;
export const NODE_HEIGHT = 74;
const GAP_X = 24;
const GAP_Y = 64;
const PAD = 24;

export function layoutTopology(model: NetworkModel): Layout {
  const devices = new Map(model.devices.map((d) => [d.id, d]));
  const neighbours = new Map<string, string[]>();
  for (const link of model.links) {
    if (!devices.has(link.from) || !devices.has(link.to)) continue;
    neighbours.set(link.from, [...(neighbours.get(link.from) ?? []), link.to]);
    neighbours.set(link.to, [...(neighbours.get(link.to) ?? []), link.from]);
  }
  const firewall = firewallOf(model);
  const root = firewall ?? [...model.devices].sort((a, b) => (neighbours.get(b.id)?.length ?? 0) - (neighbours.get(a.id)?.length ?? 0))[0];

  const layers: string[][] = [];
  const depth = new Map<string, number>();
  if (root) {
    // Providerrouter, die direkt an der Firewall hängen, kommen über die Firewall.
    const upstream = (neighbours.get(root.id) ?? []).filter((id) => devices.get(id)?.kind === "router" && root.kind === "firewall");
    if (upstream.length) {
      layers.push(upstream);
      upstream.forEach((id) => depth.set(id, 0));
    }
    const base = layers.length;
    depth.set(root.id, base);
    layers[base] = [root.id];
    const queue = [root.id];
    while (queue.length) {
      const current = queue.shift()!;
      const level = depth.get(current)!;
      const children = (neighbours.get(current) ?? [])
        .filter((id) => !depth.has(id))
        .sort(
          (a, b) =>
            kindOrder(devices.get(a)!) - kindOrder(devices.get(b)!) || devices.get(a)!.name.localeCompare(devices.get(b)!.name, "de"),
        );
      for (const child of children) {
        depth.set(child, level + 1);
        (layers[level + 1] ??= []).push(child);
        queue.push(child);
      }
    }
  }
  const unconnected = model.devices.filter((d) => !depth.has(d.id)).map((d) => d.id);
  const rowsPerLine = 6;
  const unconnectedFrom = unconnected.length ? layers.length : null;
  for (let i = 0; i < unconnected.length; i += rowsPerLine) layers.push(unconnected.slice(i, i + rowsPerLine));

  const hasInternet = model.devices.length > 0;
  const top = PAD + (hasInternet ? NODE_HEIGHT + GAP_Y : 0);
  const widest = Math.max(1, ...layers.map((l) => l.length));
  const width = PAD * 2 + widest * NODE_WIDTH + (widest - 1) * GAP_X;
  const nodes: PlacedNode[] = [];
  layers.forEach((layer, row) => {
    const rowWidth = layer.length * NODE_WIDTH + (layer.length - 1) * GAP_X;
    const start = (width - rowWidth) / 2;
    layer.forEach((id, column) => {
      nodes.push({ device: devices.get(id)!, x: start + column * (NODE_WIDTH + GAP_X), y: top + row * (NODE_HEIGHT + GAP_Y) });
    });
  });
  const height = top + layers.length * (NODE_HEIGHT + GAP_Y) - GAP_Y + PAD;
  return {
    nodes,
    internet: hasInternet ? { x: width / 2 - NODE_WIDTH / 2, y: PAD } : null,
    width,
    height: Math.max(height, PAD * 2 + NODE_HEIGHT),
    unconnectedY: unconnectedFrom === null ? null : top + unconnectedFrom * (NODE_HEIGHT + GAP_Y),
  };
}

const ORDER = [
  "router",
  "firewall",
  "switch",
  "ap",
  "server",
  "nas",
  "usv",
  "client",
  "notebook",
  "drucker",
  "telefon",
  "kamera",
  "sonstiges",
];
const kindOrder = (device: NetDevice) => ORDER.indexOf(device.kind);
