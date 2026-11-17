import {
  broadcastOf,
  cidrText,
  contains,
  formatIp,
  ipClass,
  isNetworkOrBroadcast,
  maskOf,
  overlaps,
  parseCidr,
  parseIp,
  usableHosts,
  type Cidr,
} from "@/lib/network/ip";
import { linkNetworks, type NetDevice, type NetLink, type NetNetwork, type NetworkModel } from "@/lib/network/model";

// Netzwerk-Check: prüft die dokumentierte Konfiguration wie ein Techniker – WAN, Netze, DHCP, IP-Konflikte, VLANs auf den
// Verbindungen und ob jedes Gerät sein Gateway erreicht. Läuft sofort im Browser, während man tippt.

export type Finding = {
  level: "fehler" | "warnung" | "info";
  area: string;
  message: string;
  hint?: string;
  deviceIds?: string[];
  networkId?: string;
  linkId?: string;
};

/** Geräte, die Pakete zwischen Ports weiterreichen (Switch, AP) bzw. routen (Firewall, Router). */
const FORWARDING = new Set(["switch", "ap", "firewall", "router"]);

export function firewallOf(model: NetworkModel): NetDevice | undefined {
  return (
    model.devices.find((d) => d.id === model.wan.firewallId) ??
    model.devices.find((d) => d.kind === "firewall") ??
    model.devices.find((d) => d.kind === "router")
  );
}

type Step = { deviceId: string; linkId: string | null; fromPort?: string; toPort?: string };

/** Weg innerhalb eines Netzes (Layer 2): über Verbindungen, die dieses Netz tragen; Endgeräte leiten nicht weiter. */
function layer2Path(model: NetworkModel, networkId: string, from: string, to: string): Step[] | null {
  const devices = new Map(model.devices.map((d) => [d.id, d]));
  const previous = new Map<string, Step>([[from, { deviceId: from, linkId: null }]]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) break;
    const device = devices.get(current);
    if (current !== from && device && !FORWARDING.has(device.kind)) continue;
    for (const link of model.links) {
      if (!linkNetworks(link).has(networkId)) continue;
      const forward = link.from === current;
      if (!forward && link.to !== current) continue;
      const next = forward ? link.to : link.from;
      if (previous.has(next)) continue;
      previous.set(next, {
        deviceId: next,
        linkId: link.id,
        fromPort: forward ? link.fromPort : link.toPort,
        toPort: forward ? link.toPort : link.fromPort,
      });
      queue.push(next);
    }
  }
  if (!previous.has(to)) return null;
  const path: Step[] = [];
  for (let step: Step | undefined = previous.get(to); step; ) {
    path.unshift(step);
    if (!step.linkId) break;
    const link = model.links.find((l) => l.id === step!.linkId)!;
    step = previous.get(link.from === step.deviceId ? link.to : link.from);
  }
  return path;
}

function reachable(model: NetworkModel, networkId: string, from: string): Set<string> {
  const seen = new Set([from]);
  const queue = [from];
  const devices = new Map(model.devices.map((d) => [d.id, d]));
  while (queue.length > 0) {
    const current = queue.shift()!;
    const device = devices.get(current);
    if (current !== from && device && !FORWARDING.has(device.kind)) continue;
    for (const link of model.links) {
      if (!linkNetworks(link).has(networkId)) continue;
      const next = link.from === current ? link.to : link.to === current ? link.from : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

export function checkNetwork(model: NetworkModel): Finding[] {
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);
  const name = (id: string | undefined) => model.devices.find((d) => d.id === id)?.name ?? "?";
  const nets = model.networks.map((network) => ({ network, cidr: parseCidr(network.subnet) }));
  const netLabel = (n: NetNetwork) => `Netz „${n.name}“ (VLAN ${n.vlan})`;
  const firewall = firewallOf(model);

  // ── Internet (WAN) ──
  const { wan } = model;
  let wanNet: Cidr | null = null;
  if (!firewall && model.devices.length > 0) {
    add({
      level: "warnung",
      area: "Internet",
      message: "Keine Firewall bzw. kein Router als Gateway eingetragen.",
      hint: "Ein Gerät der Art „Firewall“ oder „Router“ anlegen.",
    });
  }
  if (wan.mode === "statisch") {
    const ip = parseIp(wan.ip);
    const gateway = parseIp(wan.gateway);
    if (ip === null) add({ level: "fehler", area: "Internet", message: "WAN-IP fehlt oder ist ungültig." });
    if (wan.prefix === undefined)
      add({
        level: "fehler",
        area: "Internet",
        message: "Netzmaske (Prefix) des WAN fehlt.",
        hint: "Steht in den Unterlagen des Providers, z. B. /29 = 255.255.255.248.",
      });
    if (ip !== null && wan.prefix !== undefined) {
      const mask = maskOf(wan.prefix);
      wanNet = { network: (ip & mask) >>> 0, prefix: wan.prefix, mask };
      if (isNetworkOrBroadcast(wanNet, ip))
        add({
          level: "fehler",
          area: "Internet",
          message: `${wan.ip} ist Netz- oder Broadcast-Adresse von ${cidrText(wanNet)} – nicht als Geräteadresse nutzbar.`,
        });
      if (gateway === null) {
        add({
          level: "fehler",
          area: "Internet",
          message: "Standardgateway des Providers fehlt – ohne Gateway kommt kein Paket ins Internet.",
        });
      } else if (gateway === ip) {
        add({ level: "fehler", area: "Internet", message: "Gateway und WAN-IP sind gleich." });
      } else if (!contains(wanNet, gateway)) {
        add({
          level: "fehler",
          area: "Internet",
          message: `Gateway ${wan.gateway} liegt nicht im WAN-Netz ${cidrText(wanNet)} – so funktioniert der Internetzugang nicht.`,
          hint: "Prefix bzw. Gateway nochmals mit den Providerdaten vergleichen.",
        });
      }
      const kind = ipClass(ip);
      if (kind === "privat") {
        add({
          level: "warnung",
          area: "Internet",
          message: `Die WAN-Adresse ${wan.ip} ist privat: die Firewall hängt hinter einem weiteren Router (doppeltes NAT).`,
          hint: "Für VPN und Portfreigaben am Providerrouter Exposed Host/Weiterleitung einrichten oder den Router in den Bridge-Modus setzen.",
        });
      } else if (kind === "cgnat") {
        add({
          level: "warnung",
          area: "Internet",
          message: "Carrier-NAT (100.64.0.0/10): Von außen ist der Anschluss nicht erreichbar – kein VPN-Server möglich.",
          hint: "Beim Provider eine öffentliche, feste IP anfragen.",
        });
      } else if (kind === "speziell") {
        add({ level: "fehler", area: "Internet", message: `${wan.ip} ist keine gültige Internetadresse.` });
      }
    }
    if (!wan.dns?.trim())
      add({
        level: "warnung",
        area: "Internet",
        message: "Kein DNS-Server für das WAN eingetragen – ohne DNS keine Namensauflösung.",
        hint: "Provider-DNS oder z. B. 1.1.1.1 / 9.9.9.9.",
      });
  } else {
    const upstream = parseCidr(wan.upstreamSubnet);
    if (wan.upstreamSubnet && !upstream)
      add({ level: "fehler", area: "Internet", message: `Netz des Providerrouters „${wan.upstreamSubnet}“ ist ungültig.` });
    if (upstream) {
      wanNet = upstream;
      if (ipClass(upstream.network) === "privat") {
        add({
          level: "warnung",
          area: "Internet",
          message: `Die Firewall bekommt ihre Adresse aus dem privaten Netz ${cidrText(upstream)} des Providerrouters (doppeltes NAT).`,
          hint: "Für VPN/Portfreigaben am Providerrouter weiterleiten oder Bridge-Modus nutzen.",
        });
      }
    }
    if (wan.mode === "pppoe")
      add({ level: "info", area: "Internet", message: "PPPoE: Die Zugangsdaten des Providers gehören in Keeper, nicht in die Doku." });
  }
  if (wanNet) {
    for (const { network, cidr } of nets) {
      if (cidr && overlaps(cidr, wanNet)) {
        add({
          level: "fehler",
          area: "Internet",
          networkId: network.id,
          message: `Das WAN-Netz ${cidrText(wanNet)} überschneidet sich mit ${netLabel(network)} – die Firewall kann nicht unterscheiden, wohin sie routen soll.`,
          hint: "Internes Netz auf einen anderen Bereich umstellen, z. B. 192.168.50.0/24.",
        });
      }
    }
  }

  // ── Netze und VLANs ──
  const vlans = new Map<number, NetNetwork>();
  for (const { network, cidr } of nets) {
    const label = netLabel(network);
    if (!Number.isInteger(network.vlan) || network.vlan < 1 || network.vlan > 4094)
      add({ level: "fehler", area: label, networkId: network.id, message: "VLAN-ID muss zwischen 1 und 4094 liegen." });
    const sameVlan = vlans.get(network.vlan);
    if (sameVlan)
      add({
        level: "fehler",
        area: label,
        networkId: network.id,
        message: `VLAN ${network.vlan} ist doppelt vergeben (auch „${sameVlan.name}“).`,
      });
    vlans.set(network.vlan, network);
    if (!cidr) {
      add({
        level: "fehler",
        area: label,
        networkId: network.id,
        message: `„${network.subnet || "(leer)"}“ ist keine gültige Netzangabe.`,
        hint: "Format: 192.168.20.0/24",
      });
      continue;
    }
    if (cidr.hostBits)
      add({
        level: "warnung",
        area: label,
        networkId: network.id,
        message: `${network.subnet} ist keine Netzadresse – gemeint ist vermutlich ${cidrText(cidr)}.`,
      });
    const gateway = parseIp(network.gateway);
    if (!network.gateway?.trim()) {
      add({
        level: "warnung",
        area: label,
        networkId: network.id,
        message: "Kein Gateway eingetragen – Geräte kommen nicht aus diesem Netz hinaus.",
      });
    } else if (gateway === null) {
      add({ level: "fehler", area: label, networkId: network.id, message: `Gateway „${network.gateway}“ ist keine gültige IP.` });
    } else if (!contains(cidr, gateway)) {
      add({
        level: "fehler",
        area: label,
        networkId: network.id,
        message: `Gateway ${network.gateway} liegt nicht im Netz ${cidrText(cidr)}.`,
      });
    } else if (isNetworkOrBroadcast(cidr, gateway)) {
      add({ level: "fehler", area: label, networkId: network.id, message: `Gateway ${network.gateway} ist Netz- oder Broadcast-Adresse.` });
    }

    const members = model.devices.filter((d) => d.networkId === network.id);
    if (members.length > usableHosts(cidr)) {
      add({
        level: "fehler",
        area: label,
        networkId: network.id,
        message: `${members.length} Geräte, aber nur ${usableHosts(cidr)} Adressen im Netz ${cidrText(cidr)}.`,
      });
    }

    const dhcp = network.dhcp;
    if (dhcp?.enabled) {
      const start = parseIp(dhcp.start);
      const end = parseIp(dhcp.end);
      if (start === null || end === null) {
        add({
          level: "fehler",
          area: label,
          networkId: network.id,
          message: "DHCP ist aktiv, aber Start oder Ende des Bereichs fehlt oder ist ungültig.",
        });
      } else {
        if (!contains(cidr, start) || !contains(cidr, end)) {
          add({
            level: "fehler",
            area: label,
            networkId: network.id,
            message: `DHCP-Bereich ${dhcp.start}–${dhcp.end} liegt nicht vollständig im Netz ${cidrText(cidr)}.`,
          });
        }
        if (start > end) add({ level: "fehler", area: label, networkId: network.id, message: "DHCP-Start liegt hinter dem DHCP-Ende." });
        if (isNetworkOrBroadcast(cidr, start) || isNetworkOrBroadcast(cidr, end)) {
          add({
            level: "fehler",
            area: label,
            networkId: network.id,
            message: "Der DHCP-Bereich enthält die Netz- oder Broadcast-Adresse.",
          });
        }
        if (gateway !== null && gateway >= start && gateway <= end) {
          add({
            level: "fehler",
            area: label,
            networkId: network.id,
            message: `Das Gateway ${network.gateway} liegt im DHCP-Bereich – ein Client kann dieselbe Adresse bekommen.`,
            hint: "Bereich z. B. erst ab .100 beginnen lassen.",
          });
        }
        const pool = start <= end ? end - start + 1 : 0;
        const dynamic = members.filter((d) => !d.ip?.trim()).length;
        if (pool > 0 && dynamic > pool)
          add({
            level: "warnung",
            area: label,
            networkId: network.id,
            message: `${dynamic} Geräte ohne feste IP, aber nur ${pool} Adressen im DHCP-Bereich.`,
          });
        for (const device of members) {
          const ip = parseIp(device.ip);
          if (ip !== null && ip >= start && ip <= end) {
            add({
              level: "warnung",
              area: label,
              networkId: network.id,
              deviceIds: [device.id],
              message: `${device.name} hat die feste IP ${device.ip} im DHCP-Bereich – Adresskonflikt möglich.`,
              hint: "Feste Adressen außerhalb des DHCP-Bereichs vergeben oder als Reservierung anlegen.",
            });
          }
        }
        if (!network.dns?.trim())
          add({
            level: "warnung",
            area: label,
            networkId: network.id,
            message: "DHCP verteilt keinen DNS-Server – Clients können keine Namen auflösen.",
          });
      }
    }
  }
  for (let i = 0; i < nets.length; i++) {
    for (let j = i + 1; j < nets.length; j++) {
      const a = nets[i];
      const b = nets[j];
      if (a.cidr && b.cidr && overlaps(a.cidr, b.cidr)) {
        add({
          level: "fehler",
          area: netLabel(a.network),
          networkId: a.network.id,
          message: `${cidrText(a.cidr)} überschneidet sich mit ${netLabel(b.network)} (${cidrText(b.cidr)}).`,
        });
      }
    }
  }

  // ── Geräte ──
  const byIp = new Map<number, NetDevice>();
  for (const device of model.devices) {
    if (!device.ip?.trim()) continue;
    const ip = parseIp(device.ip);
    if (ip === null) {
      add({ level: "fehler", area: device.name, deviceIds: [device.id], message: `„${device.ip}“ ist keine gültige IPv4-Adresse.` });
      continue;
    }
    const other = byIp.get(ip);
    if (other)
      add({
        level: "fehler",
        area: device.name,
        deviceIds: [device.id, other.id],
        message: `IP ${device.ip} ist doppelt vergeben (${other.name} und ${device.name}).`,
      });
    byIp.set(ip, device);
    const net = nets.find((n) => n.network.id === device.networkId);
    if (net?.cidr) {
      if (!contains(net.cidr, ip)) {
        add({
          level: "fehler",
          area: device.name,
          deviceIds: [device.id],
          networkId: net.network.id,
          message: `${device.ip} passt nicht ins ${netLabel(net.network)} ${cidrText(net.cidr)}.`,
          hint: `IP aus ${formatIp(net.cidr.network + 1)}–${formatIp(broadcastOf(net.cidr) - 1)} wählen oder anderes Netz zuordnen.`,
        });
      } else if (isNetworkOrBroadcast(net.cidr, ip)) {
        add({ level: "fehler", area: device.name, deviceIds: [device.id], message: `${device.ip} ist Netz- oder Broadcast-Adresse.` });
      } else if (
        net.network.gateway &&
        parseIp(net.network.gateway) === ip &&
        device.id !== firewall?.id &&
        !["firewall", "router"].includes(device.kind)
      ) {
        add({
          level: "fehler",
          area: device.name,
          deviceIds: [device.id],
          message: `${device.name} nutzt die Gateway-Adresse ${device.ip}.`,
        });
      }
    } else if (!device.networkId) {
      const fitting = nets.find((n) => n.cidr && contains(n.cidr, ip));
      if (fitting)
        add({
          level: "info",
          area: device.name,
          deviceIds: [device.id],
          message: `${device.name} gehört vermutlich ins ${netLabel(fitting.network)}.`,
        });
    }
  }

  // ── Verbindungen ──
  const usedPorts = new Map<string, NetLink>();
  const devices = new Map(model.devices.map((d) => [d.id, d]));
  for (const link of model.links) {
    const label = `${name(link.from)} ↔ ${name(link.to)}`;
    if (link.from === link.to) add({ level: "fehler", area: label, linkId: link.id, message: "Verbindung zu sich selbst." });
    for (const [deviceId, port] of [
      [link.from, link.fromPort],
      [link.to, link.toPort],
    ] as const) {
      if (!port) continue;
      const keyName = `${deviceId}|${port.toLowerCase()}`;
      const other = usedPorts.get(keyName);
      if (other)
        add({
          level: "fehler",
          area: label,
          linkId: link.id,
          deviceIds: [deviceId],
          message: `Port „${port}“ an ${name(deviceId)} ist doppelt belegt.`,
        });
      usedPorts.set(keyName, link);
      const device = devices.get(deviceId);
      if (device?.ports?.length && !device.ports.some((p) => p.toLowerCase() === port.toLowerCase())) {
        add({
          level: "warnung",
          area: label,
          linkId: link.id,
          deviceIds: [deviceId],
          message: `${device.name} hat laut Bibliothek keinen Port „${port}“.`,
        });
      }
    }
    // Endgerät im Netz X, Port liefert aber ein anderes Netz
    for (const deviceId of [link.from, link.to]) {
      const device = devices.get(deviceId);
      if (!device?.networkId || FORWARDING.has(device.kind) || device.kind === "server") continue;
      const carried = linkNetworks(link);
      if (carried.size > 0 && !carried.has(device.networkId)) {
        const expected = model.networks.find((n) => n.id === device.networkId);
        const actual = model.networks.find((n) => n.id === link.untagged);
        add({
          level: "fehler",
          area: label,
          linkId: link.id,
          deviceIds: [device.id],
          message: `${device.name} ist im ${expected ? netLabel(expected) : "Netz ?"}, der Anschluss liefert aber ${actual ? netLabel(actual) : "ein anderes Netz"}.`,
          hint: expected ? `Port auf VLAN ${expected.vlan} (untagged) stellen.` : undefined,
        });
      }
    }
  }

  // ── Erreichbarkeit: kommt jedes Gerät zu seinem Gateway? ──
  if (firewall) {
    for (const { network } of nets) {
      const members = model.devices.filter((d) => d.networkId === network.id && d.id !== firewall.id);
      if (members.length === 0) continue;
      const fromFirewall = reachable(model, network.id, firewall.id);
      if (fromFirewall.size === 1) {
        add({
          level: "fehler",
          area: netLabel(network),
          networkId: network.id,
          deviceIds: [firewall.id],
          message: `Die Firewall ${firewall.name} hat keine Verbindung, die ${netLabel(network)} trägt – kein Gerät dort erreicht das Gateway.`,
          hint: "Uplink der Firewall zum Switch für dieses VLAN freigeben (tagged/untagged).",
        });
        continue;
      }
      for (const device of members) {
        if (fromFirewall.has(device.id)) continue;
        const hasLinks = model.links.some((l) => l.from === device.id || l.to === device.id);
        add({
          level: "fehler",
          area: device.name,
          deviceIds: [device.id],
          networkId: network.id,
          message: hasLinks
            ? `${device.name} erreicht das Gateway im ${netLabel(network)} nicht – eine Verbindung auf dem Weg trägt dieses VLAN nicht.`
            : `${device.name} ist mit nichts verbunden.`,
          hint: hasLinks ? "Uplinks zwischen den Switches für das VLAN als tagged einrichten." : "Verbindung zum Switch eintragen.",
        });
      }
    }
  }
  const order = { fehler: 0, warnung: 1, info: 2 };
  return findings.sort((a, b) => order[a.level] - order[b.level]);
}

export type Hop = { deviceId: string; name: string; port?: string };
export type Trace = { ok: boolean; message: string; hops: Hop[]; linkIds: string[]; note?: string };

/** „Ping“ im Plan: zeigt den Weg von einem Gerät ins Internet oder zu einem anderen Gerät – oder wo es scheitert. */
export function tracePath(model: NetworkModel, fromId: string, toId: string): Trace {
  const device = model.devices.find((d) => d.id === fromId);
  if (!device) return { ok: false, message: "Gerät nicht gefunden.", hops: [], linkIds: [] };
  if (!device.networkId) return { ok: false, message: `${device.name} ist keinem Netz zugeordnet.`, hops: [], linkIds: [] };
  const firewall = firewallOf(model);
  const name = (id: string) => model.devices.find((d) => d.id === id)?.name ?? "?";
  const toHops = (steps: Step[]): Hop[] => steps.map((s) => ({ deviceId: s.deviceId, name: name(s.deviceId), port: s.toPort }));
  const findings = checkNetwork(model);
  const deviceErrors = findings.filter((f) => f.level === "fehler" && f.deviceIds?.includes(fromId) && f.area === device.name);
  if (deviceErrors.length > 0) return { ok: false, message: deviceErrors[0].message, hops: [], linkIds: [] };

  const leg = (networkId: string, from: string, to: string) => layer2Path(model, networkId, from, to);
  const network = model.networks.find((n) => n.id === device.networkId)!;

  if (toId === "internet") {
    if (!firewall) return { ok: false, message: "Keine Firewall/kein Router als Gateway eingetragen.", hops: [], linkIds: [] };
    const path = leg(network.id, fromId, firewall.id);
    if (!path)
      return {
        ok: false,
        message: `Kein Weg von ${device.name} zur Firewall im Netz „${network.name}“.`,
        hops: [{ deviceId: fromId, name: device.name }],
        linkIds: [],
      };
    const wanErrors = findings.filter((f) => f.level === "fehler" && f.area === "Internet");
    const hops = [...toHops(path), { deviceId: "internet", name: "Internet" }];
    const linkIds = path.map((s) => s.linkId).filter((id): id is string => Boolean(id));
    if (wanErrors.length > 0)
      return { ok: false, message: `Bis zur Firewall ok – dann scheitert es: ${wanErrors[0].message}`, hops, linkIds };
    if (!network.gateway) return { ok: false, message: `Im Netz „${network.name}“ ist kein Gateway eingetragen.`, hops, linkIds };
    return { ok: true, message: `${device.name} kommt über ${firewall.name} ins Internet.`, hops, linkIds };
  }

  const target = model.devices.find((d) => d.id === toId);
  if (!target) return { ok: false, message: "Ziel nicht gefunden.", hops: [], linkIds: [] };
  if (!target.networkId) return { ok: false, message: `${target.name} ist keinem Netz zugeordnet.`, hops: [], linkIds: [] };
  if (target.networkId === device.networkId) {
    const path = leg(network.id, fromId, toId);
    return path
      ? {
          ok: true,
          message: `Direkt im selben Netz „${network.name}“.`,
          hops: toHops(path),
          linkIds: path.map((s) => s.linkId).filter((id): id is string => Boolean(id)),
        }
      : { ok: false, message: `Kein Weg im Netz „${network.name}“ zwischen ${device.name} und ${target.name}.`, hops: [], linkIds: [] };
  }
  if (!firewall) return { ok: false, message: "Verschiedene Netze, aber kein Gateway zum Routen.", hops: [], linkIds: [] };
  const targetNetwork = model.networks.find((n) => n.id === target.networkId)!;
  const first = leg(network.id, fromId, firewall.id);
  const second = leg(targetNetwork.id, firewall.id, toId);
  if (!first) return { ok: false, message: `${device.name} erreicht die Firewall im Netz „${network.name}“ nicht.`, hops: [], linkIds: [] };
  if (!second)
    return {
      ok: false,
      message: `Die Firewall erreicht ${target.name} im Netz „${targetNetwork.name}“ nicht.`,
      hops: toHops(first),
      linkIds: [],
    };
  return {
    ok: true,
    message: `Über ${firewall.name} geroutet: „${network.name}“ → „${targetNetwork.name}“.`,
    note: `Auf ${firewall.name} muss eine Regel ${network.name} → ${targetNetwork.name} das erlauben.`,
    hops: [...toHops(first), ...toHops(second).slice(1)],
    linkIds: [...first, ...second].map((s) => s.linkId).filter((id): id is string => Boolean(id)),
  };
}
