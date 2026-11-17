import { describe, expect, it } from "vitest";
import { checkNetwork, tracePath } from "@/lib/network/check";
import { searchCatalog } from "@/lib/network/catalog";
import { cidrText, ipClass, parseCidr, parseIp, parsePrefix, usableHosts } from "@/lib/network/ip";
import type { NetworkModel } from "@/lib/network/model";

// Typisches Kundennetz: Securepoint-Firewall, UniFi-Switch und -AP, Server, Drucker, PCs in drei VLANs.
function sample(): NetworkModel {
  return {
    version: 1,
    wan: { mode: "statisch", ip: "203.0.113.10", prefix: 29, gateway: "203.0.113.9", dns: "1.1.1.1", firewallId: "fw" },
    networks: [
      { id: "srv", name: "Server", vlan: 10, subnet: "192.168.10.0/24", gateway: "192.168.10.1" },
      {
        id: "cli",
        name: "Clients",
        vlan: 20,
        subnet: "192.168.20.0/24",
        gateway: "192.168.20.1",
        dhcp: { enabled: true, start: "192.168.20.100", end: "192.168.20.200" },
        dns: "192.168.10.10",
      },
      { id: "prn", name: "Drucker", vlan: 30, subnet: "192.168.30.0/24", gateway: "192.168.30.1" },
    ],
    devices: [
      {
        id: "fw",
        name: "FW-01",
        kind: "firewall",
        vendor: "Securepoint",
        model: "RC100",
        ip: "192.168.10.1",
        networkId: "srv",
        ports: ["eth0", "eth1", "eth2", "eth3"],
      },
      {
        id: "sw",
        name: "SW-Core",
        kind: "switch",
        vendor: "Ubiquiti UniFi",
        model: "Switch 24 PoE",
        ip: "192.168.10.2",
        networkId: "srv",
        ports: Array.from({ length: 24 }, (_, i) => String(i + 1)),
      },
      { id: "ap", name: "AP-Büro", kind: "ap", vendor: "Ubiquiti UniFi", model: "U6 Pro", ip: "192.168.10.3", networkId: "srv" },
      {
        id: "dc",
        name: "SRV-DC01",
        kind: "server",
        vendor: "TERRA (Wortmann)",
        model: "TERRA SERVER Rack",
        ip: "192.168.10.10",
        networkId: "srv",
      },
      { id: "prn", name: "Drucker 2. Stock", kind: "drucker", vendor: "Kyocera", ip: "192.168.30.20", networkId: "prn" },
      { id: "pc1", name: "PC Empfang", kind: "client", vendor: "HP", model: "ProDesk", networkId: "cli" },
      { id: "nb1", name: "NB Huber", kind: "notebook", vendor: "Lenovo", model: "ThinkPad", networkId: "cli" },
    ],
    links: [
      { id: "l1", from: "fw", fromPort: "eth0", to: "sw", toPort: "24", medium: "kupfer", untagged: "srv", tagged: ["cli", "prn"] },
      { id: "l2", from: "sw", fromPort: "1", to: "dc", toPort: "LAN 1", medium: "kupfer", untagged: "srv" },
      { id: "l3", from: "sw", fromPort: "2", to: "pc1", medium: "kupfer", untagged: "cli" },
      { id: "l4", from: "sw", fromPort: "3", to: "prn", medium: "kupfer", untagged: "prn" },
      { id: "l5", from: "sw", fromPort: "4", to: "ap", toPort: "LAN (PoE)", medium: "kupfer", untagged: "srv", tagged: ["cli"] },
      { id: "l6", from: "ap", to: "nb1", medium: "wlan", untagged: "cli" },
    ],
  };
}

const errors = (model: NetworkModel) => checkNetwork(model).filter((f) => f.level === "fehler");
const messages = (model: NetworkModel) => checkNetwork(model).map((f) => `${f.level}: ${f.message}`);

describe("IP-Rechnen", () => {
  it("rechnet Netze, Hosts und Adressarten", () => {
    expect(parseIp("192.168.1.256")).toBeNull();
    expect(parseIp("192.168.01.1")).toBeNull();
    const net = parseCidr("192.168.20.5/24")!;
    expect(cidrText(net)).toBe("192.168.20.0/24");
    expect(net.hostBits).toBe(true);
    expect(usableHosts(parseCidr("203.0.113.8/29")!)).toBe(6);
    expect(parsePrefix("255.255.255.248")).toBe(29);
    expect(parsePrefix("/24")).toBe(24);
    expect(ipClass(parseIp("192.168.178.20")!)).toBe("privat");
    expect(ipClass(parseIp("100.80.1.1")!)).toBe("cgnat");
    expect(ipClass(parseIp("203.0.113.10")!)).toBe("oeffentlich");
  });

  it("findet Geräte in der Bibliothek", () => {
    expect(searchCatalog("unifi 24").map((e) => e.model)).toContain("Switch 24 PoE");
    expect(searchCatalog("securepoint").length).toBeGreaterThanOrEqual(4);
    expect(searchCatalog("terra server").map((e) => e.model)).toEqual(["TERRA SERVER Tower", "TERRA SERVER Rack"]);
  });
});

describe("Netzwerk-Check", () => {
  it("meldet bei einer sauberen Konfiguration keine Fehler", () => {
    expect(errors(sample())).toEqual([]);
  });

  it("erkennt ein Gateway außerhalb des WAN-Netzes", () => {
    const model = sample();
    model.wan.gateway = "203.0.113.1";
    expect(messages(model)).toContain(
      "fehler: Gateway 203.0.113.1 liegt nicht im WAN-Netz 203.0.113.8/29 – so funktioniert der Internetzugang nicht.",
    );
  });

  it("warnt vor doppeltem NAT und findet Überschneidungen mit dem Providernetz", () => {
    const model = sample();
    model.wan = { mode: "statisch", ip: "192.168.20.2", prefix: 24, gateway: "192.168.20.254", dns: "192.168.20.254", firewallId: "fw" };
    const all = messages(model);
    expect(all.some((m) => m.startsWith("warnung: Die WAN-Adresse 192.168.20.2 ist privat"))).toBe(true);
    expect(all.some((m) => m.startsWith("fehler: Das WAN-Netz 192.168.20.0/24 überschneidet sich mit Netz „Clients“"))).toBe(true);
  });

  it("prüft DHCP-Bereich, Gateway und IP-Konflikte", () => {
    const model = sample();
    model.networks[1].dhcp = { enabled: true, start: "192.168.20.1", end: "192.168.20.50" };
    model.devices[5].ip = "192.168.20.30";
    model.devices[6].ip = "192.168.20.30";
    model.devices[4].ip = "192.168.31.20";
    const all = messages(model);
    expect(all).toContain("fehler: Das Gateway 192.168.20.1 liegt im DHCP-Bereich – ein Client kann dieselbe Adresse bekommen.");
    expect(all).toContain("fehler: IP 192.168.20.30 ist doppelt vergeben (PC Empfang und NB Huber).");
    expect(all).toContain("warnung: PC Empfang hat die feste IP 192.168.20.30 im DHCP-Bereich – Adresskonflikt möglich.");
    expect(all).toContain("fehler: 192.168.31.20 passt nicht ins Netz „Drucker“ (VLAN 30) 192.168.30.0/24.");
  });

  it("findet falsche VLANs am Switchport und fehlende VLANs am Uplink", () => {
    const model = sample();
    model.links[2].untagged = "srv"; // PC-Port im Server-VLAN
    model.links[0].tagged = ["cli"]; // Drucker-VLAN fehlt am Uplink zur Firewall
    const all = messages(model);
    expect(all).toContain("fehler: PC Empfang ist im Netz „Clients“ (VLAN 20), der Anschluss liefert aber Netz „Server“ (VLAN 10).");
    expect(all.some((m) => m.startsWith("fehler: Die Firewall FW-01 hat keine Verbindung, die Netz „Drucker“ (VLAN 30) trägt"))).toBe(true);
  });

  it("erkennt doppelt belegte Ports, überschneidende Netze und doppelte VLAN-IDs", () => {
    const model = sample();
    model.links[3].fromPort = "2";
    model.networks.push({ id: "gast", name: "Gäste", vlan: 20, subnet: "192.168.20.128/25" });
    const all = messages(model);
    expect(all).toContain("fehler: Port „2“ an SW-Core ist doppelt belegt.");
    expect(all).toContain("fehler: VLAN 20 ist doppelt vergeben (auch „Clients“).");
    expect(all).toContain("fehler: 192.168.20.0/24 überschneidet sich mit Netz „Gäste“ (VLAN 20) (192.168.20.128/25).");
  });
});

describe("Weg verfolgen", () => {
  it("zeigt den Weg ins Internet über Switch und Firewall", () => {
    const trace = tracePath(sample(), "nb1", "internet");
    expect(trace).toMatchObject({ ok: true, message: "NB Huber kommt über FW-01 ins Internet." });
    expect(trace.hops.map((h) => h.name)).toEqual(["NB Huber", "AP-Büro", "SW-Core", "FW-01", "Internet"]);
    expect(trace.linkIds).toEqual(["l6", "l5", "l1"]);
  });

  it("routet zwischen VLANs über die Firewall und sagt, dass eine Regel nötig ist", () => {
    const trace = tracePath(sample(), "pc1", "prn");
    expect(trace.ok).toBe(true);
    expect(trace.hops.map((h) => h.name)).toEqual(["PC Empfang", "SW-Core", "FW-01", "SW-Core", "Drucker 2. Stock"]);
    expect(trace.note).toBe("Auf FW-01 muss eine Regel Clients → Drucker das erlauben.");
  });

  it("zeigt, wo es scheitert", () => {
    const model = sample();
    model.links[4].tagged = []; // AP bekommt das Client-VLAN nicht
    expect(tracePath(model, "nb1", "internet")).toMatchObject({ ok: false });
    expect(tracePath(model, "nb1", "internet").message).toContain("erreicht das Gateway");
    model.links[4].tagged = ["cli"];
    model.wan.gateway = "198.51.100.1";
    const wan = tracePath(model, "pc1", "internet");
    expect(wan.ok).toBe(false);
    expect(wan.message).toMatch(/^Bis zur Firewall ok – dann scheitert es: Gateway 198\.51\.100\.1 liegt nicht im WAN-Netz/);
  });
});
