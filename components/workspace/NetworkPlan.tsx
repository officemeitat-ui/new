"use client";

import { useEffect, useRef, useState } from "react";
import type { Finding } from "@/lib/network/check";
import { layoutTopology, NODE_HEIGHT, NODE_WIDTH } from "@/lib/network/layout";
import { DEVICE_KINDS, type DeviceKind, type NetworkModel } from "@/lib/network/model";

// Grafischer Netzwerkplan (SVG): Internet, Firewall, Switches, Endgeräte mit Ports, VLAN-Farben und Fehlermarkierung.

const KIND_STYLE: Record<DeviceKind, { fill: string; stroke: string; glyph: string }> = {
  firewall: { fill: "#ffedd5", stroke: "#c2410c", glyph: "M4 6h16M4 12h16M4 18h16M8 6v6M16 12v6M12 6v0" },
  router: { fill: "#e0e7ff", stroke: "#4f46e5", glyph: "M12 3v18M3 12h18M7 7l10 10M17 7 7 17" },
  switch: { fill: "#e0f2fe", stroke: "#0284c7", glyph: "M4 9h16M4 15h16M7 9l-3 3 3 3M17 9l3 3-3 3" },
  ap: { fill: "#ecfeff", stroke: "#0891b2", glyph: "M5 12a10 10 0 0 1 14 0M8 15a5 5 0 0 1 8 0M12 18h0" },
  server: { fill: "#dcfce7", stroke: "#16a34a", glyph: "M5 4h14v6H5zM5 14h14v6H5zM8 7h0M8 17h0" },
  nas: { fill: "#ccfbf1", stroke: "#0d9488", glyph: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h6" },
  client: { fill: "#f1f5f9", stroke: "#475569", glyph: "M4 5h16v10H4zM9 19h6M12 15v4" },
  notebook: { fill: "#f1f5f9", stroke: "#475569", glyph: "M6 6h12v9H6zM3 18h18" },
  drucker: { fill: "#fef9c3", stroke: "#ca8a04", glyph: "M7 9V4h10v5M5 9h14v7H5zM8 14h8v6H8z" },
  telefon: { fill: "#f3e8ff", stroke: "#9333ea", glyph: "M7 4h10v16H7zM10 17h4" },
  kamera: { fill: "#f3e8ff", stroke: "#9333ea", glyph: "M4 8h11v8H4zM15 11l5-3v8l-5-3" },
  usv: { fill: "#fef3c7", stroke: "#d97706", glyph: "M13 3 6 13h5l-1 8 7-10h-5z" },
  sonstiges: { fill: "#f5f5f4", stroke: "#78716c", glyph: "M12 4v16M4 12h16" },
};

const MEDIUM_STYLE = {
  kupfer: { stroke: "#64748b", dash: undefined },
  glasfaser: { stroke: "#ea580c", dash: undefined },
  wlan: { stroke: "#0891b2", dash: "6 5" },
  vpn: { stroke: "#7c3aed", dash: "2 4" },
} as const;

export function NetworkPlan({
  model,
  findings,
  highlightLinks = [],
  highlightDevices = [],
  wanLabel,
  onSelect,
}: {
  model: NetworkModel;
  findings: Finding[];
  highlightLinks?: string[];
  highlightDevices?: string[];
  wanLabel?: string;
  onSelect?: (deviceId: string) => void;
}) {
  const layout = layoutTopology(model);
  // Am Handy ist der Plan meist breiter als der Bildschirm: eingepasst als Überblick, vergrößert zum Scrollen.
  const [fit, setFit] = useState(true);
  const [tooWide, setTooWide] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setTooWide(layout.width > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout.width]);
  useEffect(() => {
    const el = scroller.current;
    if (el && !fit) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [fit]);
  if (model.devices.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
        Noch keine Geräte – unter „Geräte“ aus der Bibliothek hinzufügen.
      </p>
    );
  }
  const positions = new Map(layout.nodes.map((n) => [n.device.id, n]));
  const errorDevices = new Set(findings.filter((f) => f.level === "fehler").flatMap((f) => f.deviceIds ?? []));
  const warnDevices = new Set(findings.filter((f) => f.level === "warnung").flatMap((f) => f.deviceIds ?? []));
  const networkName = new Map(model.networks.map((n) => [n.id, n]));
  const topNodes = layout.nodes.filter(
    (n) => n.y === Math.min(...layout.nodes.map((m) => m.y)) && ["router", "firewall"].includes(n.device.kind),
  );
  const center = (id: string) => {
    const node = positions.get(id)!;
    return { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT / 2, node };
  };

  return (
    <div className="relative rounded-xl bg-white ring-1 ring-slate-200">
      {tooWide && (
        <button
          type="button"
          onClick={() => setFit(!fit)}
          className="absolute top-2 right-2 z-10 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300"
        >
          {fit ? "Vergrößern" : "Einpassen"}
        </button>
      )}
      <div ref={scroller} className="overflow-x-auto rounded-xl">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={fit ? undefined : layout.width}
          height={fit ? undefined : layout.height}
          style={fit ? { width: "100%", height: "auto", maxWidth: layout.width } : undefined}
          className="mx-auto block"
          role="img"
          aria-label="Netzwerkplan"
        >
          {/* Internet */}
          {layout.internet && (
            <g>
              {topNodes.map((n) => (
                <line
                  key={n.device.id}
                  x1={layout.internet!.x + NODE_WIDTH / 2}
                  y1={layout.internet!.y + NODE_HEIGHT - 8}
                  x2={n.x + NODE_WIDTH / 2}
                  y2={n.y}
                  stroke="#94a3b8"
                  strokeWidth={2}
                />
              ))}
              <path
                d={`M${layout.internet.x + 30} ${layout.internet.y + 56} a18 18 0 0 1 4-34 a26 26 0 0 1 48-8 a20 20 0 0 1 38 10 a16 16 0 0 1 2 32 z`}
                fill="#f8fafc"
                stroke="#94a3b8"
                strokeWidth={1.5}
              />
              <text
                x={layout.internet.x + NODE_WIDTH / 2}
                y={layout.internet.y + 40}
                textAnchor="middle"
                className="fill-slate-700 text-[12px] font-semibold"
              >
                Internet
              </text>
              {wanLabel && (
                <text
                  x={layout.internet.x + NODE_WIDTH / 2 + 8}
                  y={layout.internet.y + NODE_HEIGHT + 22}
                  className="fill-slate-600 text-[10px]"
                >
                  WAN {wanLabel}
                </text>
              )}
            </g>
          )}

          {/* Verbindungen */}
          {model.links.map((link) => {
            if (!positions.has(link.from) || !positions.has(link.to)) return null;
            const a = center(link.from);
            const b = center(link.to);
            const [upper, lower] = a.y <= b.y ? [a, b] : [b, a];
            const sameRow = upper.y === lower.y;
            const x1 = sameRow ? Math.min(upper.x, lower.x) + NODE_WIDTH / 2 : upper.x;
            const y1 = sameRow ? upper.y : upper.y + NODE_HEIGHT / 2;
            const x2 = sameRow ? Math.max(upper.x, lower.x) - NODE_WIDTH / 2 : lower.x;
            const y2 = sameRow ? lower.y : lower.y - NODE_HEIGHT / 2;
            const style = MEDIUM_STYLE[link.medium];
            const highlighted = highlightLinks.includes(link.id);
            const upperPort = upper === a ? link.fromPort : link.toPort;
            const lowerPort = upper === a ? link.toPort : link.fromPort;
            const vlan = link.untagged ? networkName.get(link.untagged)?.vlan : undefined;
            const tagged = (link.tagged ?? []).map((id) => networkName.get(id)?.vlan).filter(Boolean);
            return (
              <g key={link.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={highlighted ? "#4f46e5" : style.stroke}
                  strokeWidth={highlighted ? 4 : 2}
                  strokeDasharray={style.dash}
                />
                {upperPort && (
                  <text x={x1 + (x2 - x1) * 0.18 + 4} y={y1 + (y2 - y1) * 0.18} className="fill-slate-500 text-[9px]">
                    {upperPort}
                  </text>
                )}
                {lowerPort && (
                  <text x={x1 + (x2 - x1) * 0.82 + 4} y={y1 + (y2 - y1) * 0.82} className="fill-slate-500 text-[9px]">
                    {lowerPort}
                  </text>
                )}
                {(vlan || tagged.length > 0) && (
                  <text x={(x1 + x2) / 2 + 4} y={(y1 + y2) / 2} className="fill-indigo-600 text-[9px] font-semibold">
                    {[vlan ? `V${vlan}` : null, tagged.length ? `T:${tagged.join(",")}` : null].filter(Boolean).join(" ")}
                  </text>
                )}
              </g>
            );
          })}

          {/* Geräte */}
          {layout.nodes.map(({ device, x, y }) => {
            const style = KIND_STYLE[device.kind];
            const error = errorDevices.has(device.id);
            const warn = warnDevices.has(device.id);
            const highlighted = highlightDevices.includes(device.id);
            const net = device.networkId ? networkName.get(device.networkId) : undefined;
            return (
              <g
                key={device.id}
                transform={`translate(${x} ${y})`}
                onClick={() => onSelect?.(device.id)}
                className={onSelect ? "cursor-pointer" : undefined}
              >
                <title>
                  {[
                    device.name,
                    DEVICE_KINDS[device.kind],
                    [device.vendor, device.model].filter(Boolean).join(" "),
                    device.ip,
                    net ? `${net.name} (VLAN ${net.vlan})` : null,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </title>
                <rect
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={10}
                  fill={style.fill}
                  stroke={error ? "#dc2626" : warn ? "#d97706" : highlighted ? "#4f46e5" : style.stroke}
                  strokeWidth={error || warn || highlighted ? 3 : 1.5}
                />
                <svg
                  x={8}
                  y={8}
                  width={22}
                  height={22}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={style.stroke}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={style.glyph} />
                </svg>
                <text x={36} y={22} className="fill-slate-900 text-[12px] font-semibold">
                  {device.name.length > 15 ? `${device.name.slice(0, 14)}…` : device.name}
                </text>
                <text x={10} y={44} className="fill-slate-500 text-[10px]">
                  {shortModel(device.vendor, device.model) || DEVICE_KINDS[device.kind]}
                </text>
                <text x={10} y={60} className="fill-slate-700 text-[10px]">
                  {[device.ip, net ? `VLAN ${net.vlan}` : null].filter(Boolean).join(" · ")}
                </text>
                {error && <circle cx={NODE_WIDTH - 8} cy={8} r={7} fill="#dc2626" />}
              </g>
            );
          })}
          {layout.unconnectedY !== null && (
            <text x={12} y={layout.unconnectedY - 8} className="fill-slate-400 text-[10px]">
              ohne Verbindung zur Firewall
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}

/** Hersteller + Modell, passend für die Gerätekachel (sonst nur das Modell, notfalls gekürzt). */
function shortModel(vendor?: string, model?: string): string {
  const full = [vendor, model].filter(Boolean).join(" ");
  if (full.length <= 24) return full;
  if (model && model.length <= 24) return model;
  return `${full.slice(0, 23)}…`;
}
