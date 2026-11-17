import "server-only";
import { KI_KOMPETENZ, SELF_ASSESSMENT } from "@/lib/awareness/content";
import { addLearners, completeStep, courseSteps, saveAssessment, saveOrgContacts, submitQuiz } from "@/lib/awareness/store";
import type { DomainCheck } from "@/lib/checks/domain";
import { db } from "@/lib/db";
import type { NetworkModel } from "@/lib/network/model";
import { createChecklist, getChecklist, toggleChecklistItem } from "@/lib/workspace/checklists";
import { addRackItem, createPage, createRack, savePort } from "@/lib/workspace/docs";
import { addPackage, addTimeEntry } from "@/lib/workspace/hours";
import { saveNetwork } from "@/lib/workspace/network";
import { saveCheckResult, saveRecord } from "@/lib/workspace/records";
import { createTask } from "@/lib/workspace/tasks";
import { serviceMap, setBookedService } from "@/lib/workspace/catalog";
import { buildItems, buildTiers, insertQuote } from "@/lib/workspace/quotes";

// Demo-Welt zum Ausprobieren: drei Kunden mit Tickets, Doku, Netzplan, Fristen, Checklisten, Stunden und Schulungen.
// Alles hat IDs mit „demo-“ und lässt sich mit einem Klick wieder entfernen. Nie mit echten Kundendaten vermischen.

export const DEMO_PREFIX = "demo-";

const day = (offset: number, now: Date) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (offsetHours: number, now: Date) => new Date(now.getTime() + offsetHours * 3_600_000).toISOString();

type DemoCustomer = { id: string; name: string; email: string; phone: string; address: string; domain: string };

const CUSTOMERS: DemoCustomer[] = [
  {
    id: "demo-huber",
    name: "Huber Steuerberatung (Demo)",
    email: "office@huber-stb.example",
    phone: "+43 732 123 456",
    address: "Hauptplatz 1, 4020 Linz",
    domain: "huber-stb.example",
  },
  {
    id: "demo-gruber",
    name: "Bäckerei Gruber (Demo)",
    email: "office@baeckerei-gruber.example",
    phone: "+43 7242 55 66",
    address: "Stadtplatz 12, 4600 Wels",
    domain: "baeckerei-gruber.example",
  },
  {
    id: "demo-berger",
    name: "Autohaus Berger (Demo)",
    email: "service@autohaus-berger.example",
    phone: "+43 7252 778 0",
    address: "Industriestraße 8, 4400 Steyr",
    domain: "autohaus-berger.example",
  },
];

export async function demoLoaded(): Promise<boolean> {
  const result = await (await db()).execute("SELECT COUNT(*) AS n FROM customers WHERE id LIKE 'demo-%'");
  return Number(result.rows[0].n) > 0;
}

export async function removeDemo(): Promise<void> {
  const client = await db();
  for (const sql of [
    "DELETE FROM tickets WHERE id LIKE 'demo-%'",
    "DELETE FROM alerts WHERE id LIKE 'demo-%'",
    "DELETE FROM devices WHERE id LIKE 'demo-%'",
    "DELETE FROM tasks WHERE external_id LIKE 'demo:%' OR customer_id LIKE 'demo-%'",
    "DELETE FROM awareness_learners WHERE org LIKE 'demo-%'",
    "DELETE FROM awareness_orgs WHERE org LIKE 'demo-%'",
    "DELETE FROM awareness_assessments WHERE org LIKE 'demo-%'",
    "DELETE FROM rack_items WHERE rack_id IN (SELECT id FROM racks WHERE customer_id LIKE 'demo-%')",
    "DELETE FROM racks WHERE customer_id LIKE 'demo-%'",
    "DELETE FROM patch_ports WHERE customer_id LIKE 'demo-%'",
    "DELETE FROM doc_pages WHERE customer_id LIKE 'demo-%'",
    "DELETE FROM network_models WHERE customer_id LIKE 'demo-%'",
    "DELETE FROM records WHERE customer_id LIKE 'demo-%'",
    "DELETE FROM checklists WHERE customer_id LIKE 'demo-%'",
    "DELETE FROM time_entries WHERE customer_id LIKE 'demo-%'",
    "DELETE FROM hour_packages WHERE customer_id LIKE 'demo-%'",
    "DELETE FROM quotes WHERE customer_id LIKE 'demo-%'",
    "DELETE FROM customer_services WHERE customer_id LIKE 'demo-%'",
    "DELETE FROM customers WHERE id LIKE 'demo-%'",
  ]) {
    await client.execute(sql);
  }
}

function check(domain: string, grade: DomainCheck["grade"], now: Date, overrides: Partial<DomainCheck> = {}): DomainCheck {
  return {
    domain,
    checkedAt: now.toISOString(),
    mx: { hosts: [`${domain.replace(/\./g, "-")}.mail.protection.outlook.com`], provider: "Microsoft 365" },
    spf: "v=spf1 include:spf.protection.outlook.com -all",
    dmarc: `v=DMARC1; p=reject; rua=mailto:dmarc@${domain}`,
    dmarcPolicy: "reject",
    dkim: ["selector1", "selector2"],
    tls: {
      host: domain,
      validTo: new Date(now.getTime() + 64 * 86_400_000).toISOString(),
      daysLeft: 64,
      issuer: "Let's Encrypt",
      trusted: true,
    },
    tlsError: null,
    findings: [],
    grade,
    ...overrides,
  };
}

export async function seedDemo(by: string, now = new Date()): Promise<{ customers: number }> {
  if (await demoLoaded()) await removeDemo();
  const client = await db();
  const stamp = now.toISOString();
  for (const c of CUSTOMERS) {
    await client.execute({
      sql: "INSERT INTO customers (id, name, domains, email, phone, address, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [c.id, c.name, c.domain, c.email, c.phone, c.address, "Demo-Daten – zum Ausprobieren", stamp, stamp],
    });
  }
  const [huber, gruber, berger] = CUSTOMERS;

  // ── Vertrag, Paket, gebuchte Leistungen (MRR) ──
  for (const [c, industry, employees, pkg, end] of [
    [huber, "Steuerberatung", 12, "pro", day(400, now)],
    [gruber, "Handwerk", 18, "keins", null],
    [berger, "Handel", 25, "basis", day(45, now)],
  ] as const) {
    await client.execute({
      sql: "UPDATE customers SET industry = ?, employees = ?, package = ?, contract_end = ? WHERE id = ?",
      args: [industry, employees, pkg, end, c.id],
    });
  }
  for (const [c, code, quantity] of [
    [huber, "MW", 12],
    [huber, "SEC", 12],
    [huber, "BCK", 1],
    [huber, "M365B", 12],
    [huber, "MFW", 1],
    [berger, "MW", 25],
  ] as const) {
    await setBookedService(c.id, code, quantity, null, now);
  }

  // ── Tickets, Warnungen, Geräte (sonst aus Atera) ──
  const tickets: [string, DemoCustomer, string, string, string, number, boolean][] = [
    ["demo-t1", huber, "Outlook fragt ständig nach dem Passwort", "Open", "High", -20, true],
    ["demo-t2", huber, "Neuer Mitarbeiter ab 1. des Monats", "Open", "Medium", -50, false],
    ["demo-t3", gruber, "Kassa Filiale Wels startet nicht", "Open", "Critical", -2, true],
    ["demo-t4", gruber, "Drucker Backstube druckt nur leere Seiten", "Pending", "Low", -96, false],
    ["demo-t5", berger, "VPN für Verkauf unterwegs", "Open", "Medium", -30, false],
  ];
  for (const [id, c, title, status, priority, hours, waiting] of tickets) {
    await client.execute({
      sql: `INSERT INTO tickets (id, customer_id, customer_name, title, status, priority, contact_name, created_at,
            last_customer_comment_at, last_technician_comment_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        c.id,
        c.name,
        title,
        status,
        priority,
        "Kontaktperson",
        at(hours, now),
        at(hours + 1, now),
        waiting ? null : at(hours + 2, now),
        stamp,
      ],
    });
  }
  for (const [id, c, title, priority, createdHours, responseHours, resolvedHours] of [
    ["demo-r1", huber, "Drucker 2. OG offline", "Medium", -24 * 20, 2, 26],
    ["demo-r2", huber, "Neues Postfach für Praktikantin", "Low", -24 * 12, 5, 30],
    ["demo-r3", berger, "Kassa druckt keine Belege", "High", -24 * 8, 9, 40],
    ["demo-r4", berger, "Passwort zurücksetzen", "Medium", -24 * 3, 1, 3],
  ] as const) {
    await client.execute({
      sql: `INSERT INTO tickets (id, customer_id, customer_name, title, status, priority, created_at, first_response_at, resolved_at, synced_at)
            VALUES (?, ?, ?, ?, 'Resolved', ?, ?, ?, ?, ?)`,
      args: [
        id,
        c.id,
        c.name,
        title,
        priority,
        at(createdHours, now),
        at(createdHours + responseHours, now),
        at(createdHours + resolvedHours, now),
        stamp,
      ],
    });
  }
  const alerts: [string, DemoCustomer, string, string, string][] = [
    ["demo-a1", gruber, "KASSA-WELS", "Festplatte fast voll (95 %)", "Critical"],
    ["demo-a2", huber, "SRV-DC01", "Windows-Updates seit 35 Tagen ausstehend", "Warning"],
    ["demo-a3", berger, "SRV-01", "Sicherung mit Warnungen beendet", "Warning"],
  ];
  for (const [id, c, device, title, severity] of alerts) {
    await client.execute({
      sql: "INSERT INTO alerts (id, customer_id, customer_name, device_name, title, severity, created_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [id, c.id, c.name, device, title, severity, at(-5, now), stamp],
    });
  }
  const devices: [DemoCustomer, string, string, number][] = [
    [huber, "SRV-DC01", "Windows Server 2022", 1],
    [huber, "PC-EMPFANG", "Windows 11 Pro", 1],
    [huber, "NB-HUBER", "Windows 11 Pro", 1],
    [huber, "NB-LEITNER", "Windows 11 Pro", 0],
    [gruber, "KASSA-WELS", "Windows 10 IoT", 0],
    [gruber, "PC-BUERO", "Windows 11 Pro", 1],
    [berger, "SRV-01", "Windows Server 2019", 1],
    [berger, "PC-VERKAUF-1", "Windows 11 Pro", 1],
    [berger, "PC-WERKSTATT", "Windows 10 Pro", 1],
  ];
  for (const [i, [c, name, os, online]] of devices.entries()) {
    await client.execute({
      sql: "INSERT INTO devices (id, customer_id, customer_name, name, os, online, last_seen, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      args: [`demo-d${i}`, c.id, c.name, name, os, online, at(online ? 0 : -50, now), stamp],
    });
  }

  // ── Kundenakte ──
  const record = (customerId: string, kind: string, data: Record<string, string>) => saveRecord({ customerId, kind, data }, by, now);
  await record(huber.id, "kontakt", {
    name: "Maria Huber",
    rolle: "Geschäftsführung",
    telefon: "+43 732 123 456 10",
    email: "maria.huber@huber-stb.example",
    freigabe: "ja",
    vip: "ja",
  });
  await record(huber.id, "kontakt", {
    name: "Thomas Leitner",
    rolle: "IT-Ansprechpartner",
    telefon: "+43 732 123 456 22",
    mobil: "+43 664 123 45 67",
    email: "t.leitner@huber-stb.example",
    freigabe: "ja",
  });
  await record(huber.id, "kontakt", {
    name: "Sabine Wolf",
    rolle: "Assistenz / Empfang",
    telefon: "+43 732 123 456 0",
    email: "empfang@huber-stb.example",
  });
  await record(huber.id, "standort", {
    name: "Kanzlei Linz",
    adresse: huber.address,
    oeffnungszeiten: "Mo–Do 8–17, Fr 8–12",
    technikraum: "Keller, Raum -1.04 (Schlüssel beim Empfang)",
    parken: "Tiefgarage Hauptplatz, 2 Stellplätze für Dienstleister",
  });
  const huberDevices: Record<string, string>[] = [
    {
      name: "FW-01",
      art: "Firewall",
      hersteller: "Securepoint",
      modell: "RC100",
      seriennummer: "SP-RC100-88123",
      standort: "Technikraum",
      ip: "192.168.10.1",
      garantie: day(200, now),
      lieferant: "Securepoint",
      status: "in Betrieb",
    },
    {
      name: "SW-CORE",
      art: "Switch",
      hersteller: "Ubiquiti",
      modell: "USW Pro 24 PoE",
      seriennummer: "F4E2C6A1B2C3",
      standort: "Technikraum",
      ip: "192.168.10.2",
      garantie: day(400, now),
      status: "in Betrieb",
    },
    {
      name: "SRV-DC01",
      art: "Server",
      hersteller: "TERRA (Wortmann)",
      modell: "TERRA SERVER 3030 G5",
      seriennummer: "TW-1288342",
      standort: "Technikraum",
      ip: "192.168.10.10",
      betriebssystem: "Windows Server 2022",
      gekauft: day(-1400, now),
      garantie: day(25, now),
      lieferant: "Wortmann",
      status: "in Betrieb",
    },
    {
      name: "PC-EMPFANG",
      art: "PC",
      hersteller: "HP",
      modell: "ProDesk 400 G9",
      seriennummer: "CZC2231XYZ",
      benutzer: "Sabine Wolf",
      betriebssystem: "Windows 11 Pro",
      garantie: day(500, now),
      status: "in Betrieb",
    },
    {
      name: "NB-HUBER",
      art: "Notebook",
      hersteller: "Lenovo",
      modell: "ThinkPad T14 Gen 4",
      seriennummer: "PF4XYZ12",
      benutzer: "Maria Huber",
      betriebssystem: "Windows 11 Pro",
      garantie: day(700, now),
      status: "in Betrieb",
    },
    {
      name: "NB-LEITNER",
      art: "Notebook",
      hersteller: "HP",
      modell: "EliteBook 840 G8",
      seriennummer: "5CG1234ABC",
      benutzer: "Thomas Leitner",
      betriebssystem: "Windows 11 Pro",
      garantie: day(-30, now),
      status: "in Betrieb",
    },
    {
      name: "DRUCKER-2OG",
      art: "Drucker",
      hersteller: "Kyocera",
      modell: "ECOSYS M5526cdw",
      standort: "2. Stock Kopierraum",
      ip: "192.168.30.20",
      status: "in Betrieb",
    },
  ];
  for (const d of huberDevices) await record(huber.id, "geraet", d);
  await record(huber.id, "wlan", {
    ssid: "Huber-Office",
    vlan: "20 Clients",
    sicherheit: "WPA2/WPA3",
    access_points: "AP-Büro",
    kennwort_ort: "Keeper › Huber › WLAN",
  });
  await record(huber.id, "wlan", {
    ssid: "Huber-Gast",
    vlan: "40 Gast",
    sicherheit: "WPA2",
    gast: "ja",
    kennwort_ort: "Aushang Empfang (monatlich gewechselt)",
  });
  const huberDomain = await record(huber.id, "domain", {
    domain: huber.domain,
    registrar: "World4You",
    dns: "World4You",
    mail: "Microsoft 365",
    website: "Webagentur Linz",
    ablauf: day(150, now),
  });
  await record(huber.id, "m365", {
    mandant: "huberstb.onmicrosoft.com",
    lizenzen: "12× Business Premium",
    mfa: "alle Konten",
    conditional_access: "ja",
    legacy_auth: "ja",
    notfallkonto: "ja",
    gdap: "ja",
  });
  await record(huber.id, "lizenz", {
    produkt: "Microsoft 365 Business Premium",
    hersteller: "Microsoft",
    art: "Abo jährlich",
    anzahl: "12",
    bezug: "Pax8",
    ablauf: day(140, now),
    kosten: "3168",
    automatisch: "ja",
  });
  await record(huber.id, "lizenz", {
    produkt: "Securepoint UTM-Lizenz RC100",
    hersteller: "Securepoint",
    art: "Abo jährlich",
    anzahl: "1",
    ablauf: day(18, now),
    kosten: "389",
  });
  await record(huber.id, "lizenz", {
    produkt: "ESET PROTECT Advanced",
    hersteller: "ESET",
    art: "Abo jährlich",
    anzahl: "14",
    ablauf: day(95, now),
    kosten: "520",
  });
  await record(huber.id, "vertrag", {
    titel: "IT-Wartungsvertrag",
    art: "Wartungsvertrag",
    partner: "IT Muster e.U.",
    beginn: day(-700, now),
    ende: day(400, now),
    kuendigungsfrist: "3 Monate",
    betrag: "390",
    sla: "4 Stunden werktags",
  });
  await record(huber.id, "vertrag", {
    titel: "Internet Magenta Business 300/50",
    art: "Internet / Provider",
    partner: "Magenta Telekom",
    vertragsnummer: "MT-88231",
    ende: day(100, now),
    kuendigungsfrist: "3 Monate",
    betrag: "89",
  });
  await record(huber.id, "anwendung", {
    name: "BMD NTCS",
    hersteller: "BMD Systemhaus",
    version: "2025.1",
    einsatz: "Buchhaltung, Lohn, Kanzleiverwaltung",
    server: "SRV-DC01",
    support: "BMD Hotline +43 50 883",
    updates: "quartalsweise durch BMD",
  });
  await record(huber.id, "backup", {
    name: "Server täglich",
    software: "Veeam Backup & Replication",
    quelle: "SRV-DC01 komplett",
    ziel: "Synology RS822+ und USB-Rotation",
    zeitplan: "täglich 22:00",
    aufbewahrung: "30 Tage, 12 Monatsstände",
    offline: "ja",
    letzter_test: day(-200, now),
  });
  await record(huber.id, "backup", {
    name: "Microsoft 365",
    software: "Veeam Backup for M365",
    quelle: "Postfächer, OneDrive, SharePoint",
    ziel: "Cloud (EU)",
    zeitplan: "4× täglich",
    letzter_test: day(-40, now),
  });
  await saveCheckResult(huberDomain.id, check(huber.domain, "A", now), now);

  await record(gruber.id, "kontakt", {
    name: "Josef Gruber",
    rolle: "Geschäftsführung",
    mobil: "+43 664 998 77 66",
    email: "josef@baeckerei-gruber.example",
    freigabe: "ja",
  });
  await record(gruber.id, "kontakt", {
    name: "Anna Gruber",
    rolle: "Buchhaltung",
    telefon: "+43 7242 55 66 2",
    email: "buchhaltung@baeckerei-gruber.example",
  });
  await record(gruber.id, "standort", {
    name: "Backstube & Büro Wels",
    adresse: gruber.address,
    oeffnungszeiten: "Mo–Sa ab 4:00",
    zutritt: "Hintereingang, Code in Keeper",
  });
  await record(gruber.id, "standort", { name: "Filiale Marchtrenk", adresse: "Linzer Straße 3, 4614 Marchtrenk" });
  await record(gruber.id, "geraet", {
    name: "KASSA-WELS",
    art: "PC",
    hersteller: "Wortmann",
    modell: "TERRA PC-Micro 6000",
    benutzer: "Verkauf",
    betriebssystem: "Windows 10 IoT",
    garantie: day(-200, now),
    status: "in Betrieb",
  });
  await record(gruber.id, "geraet", {
    name: "FRITZBOX",
    art: "Firewall",
    hersteller: "AVM",
    modell: "FRITZ!Box 7590",
    status: "in Betrieb",
  });
  const gruberDomain = await record(gruber.id, "domain", {
    domain: gruber.domain,
    registrar: "easyname",
    mail: "Hoster",
    ablauf: day(12, now),
  });
  await record(gruber.id, "lizenz", {
    produkt: "Kassensoftware Gastro Pro",
    hersteller: "Kassenhersteller",
    art: "Wartung / Software Assurance",
    anzahl: "2",
    ablauf: day(-3, now),
    kosten: "480",
  });
  await record(gruber.id, "vertrag", {
    titel: "Leasing Kassen",
    art: "Leasing",
    partner: "Leasing GmbH",
    ende: day(70, now),
    kuendigungsfrist: "3 Monate",
    betrag: "120",
  });
  await saveCheckResult(
    gruberDomain.id,
    check(gruber.domain, "F", now, {
      mx: { hosts: ["mx.hoster.example"], provider: "eigener bzw. anderer Server" },
      spf: null,
      dmarc: null,
      dmarcPolicy: null,
      dkim: [],
      tls: {
        host: gruber.domain,
        validTo: new Date(now.getTime() + 9 * 86_400_000).toISOString(),
        daysLeft: 9,
        issuer: "Let's Encrypt",
        trusted: true,
      },
      findings: [
        {
          level: "fehler",
          text: "Kein SPF-Eintrag – jeder kann im Namen dieser Domain E-Mails verschicken.",
          hint: "SPF für den Mailanbieter anlegen.",
        },
        {
          level: "fehler",
          text: "Kein DMARC – gefälschte Absender dieser Domain werden nicht abgewiesen.",
          hint: "TXT _dmarc: v=DMARC1; p=quarantine; rua=mailto:…",
        },
        {
          level: "fehler",
          text: `Das Zertifikat von ${gruber.domain} läuft in 9 Tagen ab.`,
          hint: "Erneuerung prüfen (Let's Encrypt automatisch?).",
        },
        { level: "info", text: "Kein DKIM unter den üblichen Selektoren gefunden (kann einen anderen Namen haben)." },
      ],
    }),
    now,
  );

  await record(berger.id, "kontakt", {
    name: "Peter Berger",
    rolle: "Geschäftsführung",
    telefon: "+43 7252 778 0",
    email: "p.berger@autohaus-berger.example",
    freigabe: "ja",
  });
  await record(berger.id, "geraet", {
    name: "SRV-01",
    art: "Server",
    hersteller: "HPE",
    modell: "ProLiant ML30 Gen10",
    betriebssystem: "Windows Server 2019",
    garantie: day(45, now),
    status: "in Betrieb",
  });
  await record(berger.id, "geraet", {
    name: "PC-VERKAUF-1",
    art: "PC",
    hersteller: "Lenovo",
    modell: "ThinkCentre M70q",
    garantie: day(600, now),
    status: "in Betrieb",
  });
  const bergerDomain = await record(berger.id, "domain", {
    domain: berger.domain,
    registrar: "World4You",
    mail: "Microsoft 365",
    ablauf: day(300, now),
  });
  await record(berger.id, "m365", { mandant: "autohausberger.onmicrosoft.com", lizenzen: "8× Business Standard", mfa: "teilweise" });
  await record(berger.id, "backup", { name: "Server täglich", software: "Windows Server-Sicherung", ziel: "USB-Festplatte" });
  await saveCheckResult(
    bergerDomain.id,
    check(berger.domain, "C", now, {
      dmarc: `v=DMARC1; p=none`,
      dmarcPolicy: "none",
      dkim: [],
      findings: [
        {
          level: "warnung",
          text: "DMARC nur im Beobachtungsmodus (p=none) – Fälschungen kommen weiter an.",
          hint: "Nach Auswertung der Berichte auf p=quarantine, dann p=reject.",
        },
        {
          level: "warnung",
          text: "DKIM ist für Microsoft 365 nicht aktiviert (selector1/selector2 fehlen).",
          hint: "Im Defender-Portal DKIM aktivieren und die beiden CNAME-Einträge setzen.",
        },
        { level: "info", text: "DMARC ohne Berichtsadresse (rua) – man sieht nicht, wer im Namen der Domain sendet." },
      ],
    }),
    now,
  );

  // ── Netzplan Huber ──
  const network: NetworkModel = {
    version: 1,
    wan: {
      mode: "statisch",
      ip: "203.0.113.10",
      prefix: 29,
      gateway: "203.0.113.9",
      dns: "1.1.1.1",
      provider: "Magenta Business 300/50",
      firewallId: "fw",
    },
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
      {
        id: "gast",
        name: "Gast",
        vlan: 40,
        subnet: "10.40.0.0/24",
        gateway: "10.40.0.1",
        dhcp: { enabled: true, start: "10.40.0.50", end: "10.40.0.250" },
        dns: "1.1.1.1",
      },
    ],
    devices: [
      {
        id: "fw",
        name: "FW-01",
        kind: "firewall",
        vendor: "Securepoint",
        model: "RC100",
        catalogId: "securepoint-rc100",
        ip: "192.168.10.1",
        networkId: "srv",
        ports: ["eth0", "eth1", "eth2", "eth3"],
      },
      {
        id: "sw",
        name: "SW-CORE",
        kind: "switch",
        vendor: "Ubiquiti UniFi",
        model: "Switch Pro 24 PoE",
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
      { id: "nas", name: "NAS-01", kind: "nas", vendor: "Synology", model: "RS822+", ip: "192.168.10.20", networkId: "srv" },
      {
        id: "prn",
        name: "Drucker 2. OG",
        kind: "drucker",
        vendor: "Kyocera",
        model: "ECOSYS M5526cdw",
        ip: "192.168.30.20",
        networkId: "prn",
      },
      { id: "pc1", name: "PC-EMPFANG", kind: "client", vendor: "HP", model: "ProDesk 400 G9", networkId: "cli" },
      { id: "nb1", name: "NB-HUBER", kind: "notebook", vendor: "Lenovo", model: "ThinkPad T14", networkId: "cli" },
    ],
    links: [
      { id: "l1", from: "fw", fromPort: "eth1", to: "sw", toPort: "24", medium: "kupfer", untagged: "srv", tagged: ["cli", "prn", "gast"] },
      { id: "l2", from: "sw", fromPort: "1", to: "dc", toPort: "LAN 1", medium: "kupfer", untagged: "srv" },
      { id: "l3", from: "sw", fromPort: "2", to: "nas", toPort: "LAN 1", medium: "kupfer", untagged: "srv" },
      { id: "l4", from: "sw", fromPort: "5", to: "pc1", medium: "kupfer", untagged: "cli" },
      { id: "l5", from: "sw", fromPort: "6", to: "prn", medium: "kupfer", untagged: "prn" },
      { id: "l6", from: "sw", fromPort: "8", to: "ap", toPort: "LAN (PoE)", medium: "kupfer", untagged: "srv", tagged: ["cli", "gast"] },
      { id: "l7", from: "ap", to: "nb1", medium: "wlan", untagged: "cli" },
    ],
  };
  await saveNetwork(huber.id, network);
  const rack = await createRack({ customerId: huber.id, name: "Serverschrank", location: "Keller, Raum -1.04", units: 24 }, now);
  for (const [name, kind, unitStart, unitHeight, model, ip] of [
    ["Patchfeld 1", "patchpanel", 24, 1, "24 Port Kat. 6A", null],
    ["SW-CORE", "switch", 22, 1, "UniFi USW Pro 24 PoE", "192.168.10.2"],
    ["FW-01", "firewall", 20, 1, "Securepoint RC100", "192.168.10.1"],
    ["SRV-DC01", "server", 10, 2, "TERRA SERVER 3030 G5", "192.168.10.10"],
    ["NAS-01", "nas", 8, 2, "Synology RS822+", "192.168.10.20"],
    ["USV", "usv", 1, 2, "APC Smart-UPS 1500", null],
  ] as const) {
    await addRackItem({ rackId: rack, name, kind, unitStart, unitHeight, model, ip }, now);
  }
  for (const [panelPort, outlet, room, switchPort, vlan, device] of [
    ["1", "1.01", "Empfang", "5", "20", "PC-EMPFANG"],
    ["2", "1.02", "Büro Huber", "7", "20", "Dockingstation"],
    ["3", "2.14", "Kopierraum", "6", "30", "Drucker 2. OG"],
    ["4", "2.20", "Besprechung", "8", "10/20/40", "AP-Büro"],
  ]) {
    await savePort(
      huber.id,
      { panel: "PP1", panelPort, outlet, room, switchName: "SW-CORE", switchPort, vlan, device, cable: "Kat. 6A", notes: null },
      undefined,
      now,
    );
  }
  await createPage(
    {
      customerId: huber.id,
      title: "Notfallplan",
      content:
        "## Wenn nichts mehr geht\n\n1. Ruhe bewahren, nichts ausschalten.\n2. IT Muster anrufen: +43 732 000 000 (24/7 im Wartungsvertrag)\n3. Bei Verdacht auf Angriff: Netzwerkkabel ziehen, WLAN aus.\n\n## Wiederanlauf\n\n| System | Reihenfolge | Dauer |\n|---|---|---|\n| Firewall | 1 | 5 Min. |\n| SRV-DC01 | 2 | 15 Min. |\n| BMD | 3 | 10 Min. |",
    },
    now,
  );

  // ── Checklisten, Aufgaben, Stunden ──
  const onboarding = await createChecklist(
    { customerId: huber.id, templateId: "onboarding", subject: "Lena Bauer", dueDate: day(6, now) },
    by,
    now,
  );
  const items = (await getChecklist(onboarding))!.items;
  for (const item of items.slice(0, 5)) await toggleChecklistItem(onboarding, item.idx, by, now);
  await createChecklist({ customerId: gruber.id, templateId: "m365-grundschutz", subject: null }, by, now);
  await createChecklist(
    { customerId: berger.id, templateId: "wartung", subject: String(now.getFullYear()), dueDate: day(20, now) },
    by,
    now,
  );

  for (const [i, [title, due, priority, c]] of (
    [
      ["Backup-Wiederherstellung testen", day(0, now), "hoch", huber],
      ["Angebot neue Kassa Filiale Wels", day(1, now), "normal", gruber],
      ["SPF und DMARC einrichten", day(2, now), "hoch", gruber],
      ["DKIM in M365 aktivieren", day(5, now), "normal", berger],
    ] as const
  ).entries()) {
    await createTask(
      { title, dueDate: due, priority, customerId: c.id, listName: "Kunden", source: "manuell", externalId: `demo:${i}` },
      now,
    );
  }
  await addPackage({ customerId: huber.id, minutes: 20 * 60, date: day(-60, now), priceCents: 190000, reference: "RE 2026-101" }, now);
  await addTimeEntry(
    { customerId: huber.id, date: day(-20, now), minutes: 90, description: "Server-Updates und Neustart", mode: "kontingent" },
    now,
  );
  await addTimeEntry(
    { customerId: huber.id, date: day(-6, now), minutes: 45, description: "Outlook-Profil neu angelegt", mode: "kontingent" },
    now,
  );
  await addPackage({ customerId: gruber.id, minutes: 5 * 60, date: day(-90, now), priceCents: 47500, reference: "RE 2026-077" }, now);
  await addTimeEntry(
    { customerId: gruber.id, date: day(-10, now), minutes: 240, description: "Kassa Filiale neu aufgesetzt", mode: "kontingent" },
    now,
  );
  await addTimeEntry({ customerId: gruber.id, date: day(-2, now), minutes: 60, description: "Drucker Backstube", mode: "kontingent" }, now);

  // ── Angebot an Bäckerei Gruber (ohne KI zusammengestellt, Preise aus dem Katalog) ──
  const services = await serviceMap();
  const ctx = { employees: 18, devices: 2, servers: 0 };
  const quoteItems = buildItems(
    [
      { code: "MW", reason: "Planbare Kosten statt Abrechnung auf Zuruf" },
      { code: "BCK", reason: "Kassendaten und Buchhaltung unveränderbar sichern" },
      { code: "MAILSEC", reason: "Domain-Prüfung: Note F" },
    ],
    services,
    ctx,
  );
  await insertQuote(
    {
      customerId: gruber.id,
      title: "Rundum betreut: Arbeitsplätze, Backup und sichere E-Mail",
      need: "Kassa fällt immer wieder aus, Backup nur auf USB, Domain ohne SPF/DMARC. Chef will planbare Kosten.",
      intro:
        "vielen Dank für das Gespräch. Damit Kassen und Büro zuverlässig laufen und Ihre Daten sicher sind, schlagen wir eine Betreuung mit festen monatlichen Kosten vor – in drei Varianten.",
      notes: "Bestehende Hardware wird übernommen; die Kassa Filiale Wels sollte zeitnah erneuert werden (Windows 10).",
      tiers: buildTiers(quoteItems, services, ctx, []),
      provider: "regeln",
      status: "gesendet",
    },
    by,
    new Date(now.getTime() - 4 * 86_400_000),
  );

  // ── Awareness ──
  await saveOrgContacts(
    huber.id,
    {
      meldestelle: "Thomas Leitner, +43 732 123 456 22",
      notfall: "IT Muster 24/7: +43 732 000 000",
      hausbank: "Raiffeisen Linz, +43 732 6596 0",
    },
    now,
  );
  const learners = await addLearners(
    huber.id,
    ["Maria Huber", "Thomas Leitner", "Sabine Wolf", "Lena Bauer", "Karl Steiner"].map((name) => ({
      name,
      email: `${name.split(" ")[0].toLowerCase()}@huber-stb.example`,
    })),
    now,
  );
  const correct = KI_KOMPETENZ.quiz.map((q) => q.correct);
  for (const [i, { learner }] of learners.entries()) {
    if (i < 3) {
      for (const step of courseSteps(KI_KOMPETENZ)) await completeStep(learner.id, KI_KOMPETENZ.id, step, now);
      await submitQuiz(learner.id, KI_KOMPETENZ.id, correct, new Date(now.getTime() - (i === 2 ? 350 : 30) * 86_400_000));
    } else if (i === 3) {
      await completeStep(learner.id, KI_KOMPETENZ.id, KI_KOMPETENZ.lessons[0].id, now);
    }
  }
  const answers: Record<string, number> = {};
  for (const [i, q] of SELF_ASSESSMENT.sections.flatMap((s) => s.questions).entries())
    answers[q.id] = i % 5 === 0 ? 0 : i % 3 === 0 ? 1 : 2;
  await saveAssessment(huber.id, answers, by, now);

  return { customers: CUSTOMERS.length };
}
