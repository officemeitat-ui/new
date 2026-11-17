import "server-only";
import type { Row } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { docKey, isSealed, seal, unseal } from "@/lib/workspace/vault";

// Kunden-Dokumentation: Doku-Seiten (Markdown), Patchschränke mit Höheneinheiten und die Patchliste (Verkabelung).

export type DocPage = {
  id: string;
  customerId: string;
  title: string;
  content: string;
  /** markdown: im Arbeitsplatz geschrieben · html: aus BookStack übernommen (wird abgeschottet angezeigt) */
  format: "markdown" | "html";
  source: "app" | "bookstack";
  bookstackPageId: string | null;
  updatedAt: string;
};

export const RACK_ITEM_KINDS = {
  patchpanel: "Patchfeld",
  switch: "Switch",
  router: "Router",
  firewall: "Firewall",
  server: "Server",
  nas: "NAS / Storage",
  usv: "USV",
  ablage: "Fachboden",
  kabelfuehrung: "Kabelführung",
  sonstiges: "Sonstiges",
} as const;
export type RackItemKind = keyof typeof RACK_ITEM_KINDS;

export type RackItem = {
  id: string;
  rackId: string;
  name: string;
  kind: RackItemKind;
  /** unterste belegte Höheneinheit (1 = ganz unten) */
  unitStart: number;
  unitHeight: number;
  model: string | null;
  ip: string | null;
  notes: string | null;
};

export type Rack = {
  id: string;
  customerId: string;
  name: string;
  location: string | null;
  units: number;
  notes: string | null;
  items: RackItem[];
};

export type PatchPort = {
  id: string;
  customerId: string;
  panel: string | null;
  panelPort: string | null;
  outlet: string | null;
  room: string | null;
  switchName: string | null;
  switchPort: string | null;
  vlan: string | null;
  device: string | null;
  cable: string | null;
  notes: string | null;
};

export type PatchInput = Omit<PatchPort, "id" | "customerId">;
export const PATCH_FIELDS: { key: keyof PatchInput; label: string }[] = [
  { key: "panel", label: "Patchfeld" },
  { key: "panelPort", label: "Port" },
  { key: "outlet", label: "Dose" },
  { key: "room", label: "Raum" },
  { key: "switchName", label: "Switch" },
  { key: "switchPort", label: "Switchport" },
  { key: "vlan", label: "VLAN" },
  { key: "device", label: "Gerät" },
  { key: "cable", label: "Kabel" },
  { key: "notes", label: "Notiz" },
];
const PATCH_COLUMNS: Record<keyof PatchInput, string> = {
  panel: "panel",
  panelPort: "panel_port",
  outlet: "outlet",
  room: "room",
  switchName: "switch_name",
  switchPort: "switch_port",
  vlan: "vlan",
  device: "device",
  cable: "cable",
  notes: "notes",
};

const text = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));
const clean = (value: string | null | undefined, max = 200) => (value ?? "").trim().slice(0, max) || null;

// Alle Inhalte der Dokumentation liegen verschlüsselt in der Datenbank, sobald der Doku-Tresor eingerichtet ist (siehe vault.ts).
type Key = Buffer | null;
const open = (key: Key, value: unknown) => text(unseal(key, value));
const byText = (a: string, b: string) => a.localeCompare(b, "de", { sensitivity: "base", numeric: true });

function toPage(row: Row, key: Key): DocPage {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    title: unseal(key, row.title) ?? "",
    content: unseal(key, row.content) ?? "",
    format: String(row.format) as DocPage["format"],
    source: String(row.source) as DocPage["source"],
    bookstackPageId: text(row.bookstack_page_id),
    updatedAt: String(row.updated_at),
  };
}

function toPort(row: Row, key: Key): PatchPort {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    panel: open(key, row.panel),
    panelPort: open(key, row.panel_port),
    outlet: open(key, row.outlet),
    room: open(key, row.room),
    switchName: open(key, row.switch_name),
    switchPort: open(key, row.switch_port),
    vlan: open(key, row.vlan),
    device: open(key, row.device),
    cable: open(key, row.cable),
    notes: open(key, row.notes),
  };
}

// ── Doku-Seiten ──

export const PAGE_TEMPLATES: Record<string, string> = {
  Netzwerk:
    "## Internet\n\n- Anbieter:\n- Anschluss / Bandbreite:\n- Öffentliche IP:\n\n## Netze und VLANs\n\n| VLAN | Name | Netz | Gateway | DHCP |\n|---|---|---|---|---|\n|  |  |  |  |  |\n\n## WLAN\n\n- SSIDs:\n- Controller / Access Points:\n",
  "Server und Dienste":
    "## Server\n\n| Name | Rolle | Betriebssystem | IP | Standort |\n|---|---|---|---|---|\n|  |  |  |  |  |\n\n## Dienste\n\n- Active Directory / Entra ID:\n- Microsoft 365 (Tenant):\n- Fachanwendungen:\n",
  Datensicherung:
    "## Was wird gesichert\n\n- \n\n## Wie und wohin\n\n- Software:\n- Ziel (lokal / extern):\n- Zeitplan:\n- Aufbewahrung:\n\n## Wiederherstellung getestet\n\n- Datum / Ergebnis:\n",
  Ansprechpartner: "| Name | Funktion | Telefon | E-Mail |\n|---|---|---|---|\n|  |  |  |  |\n",
  Notfallplan: "## Wer wird informiert\n\n1. \n\n## Erste Schritte\n\n1. \n\n## Wichtige Verträge und Hotlines\n\n- \n",
};

export async function listPages(customerId: string): Promise<DocPage[]> {
  const key = await docKey();
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM doc_pages WHERE customer_id = ?", args: [customerId] });
  return result.rows.map((row) => toPage(row, key)).sort((a, b) => byText(a.title, b.title));
}

export async function getPage(id: string): Promise<DocPage | null> {
  const key = await docKey();
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM doc_pages WHERE id = ?", args: [id] });
  return result.rows[0] ? toPage(result.rows[0], key) : null;
}

export async function createPage(
  input: {
    customerId: string;
    title: string;
    content: string;
    format?: DocPage["format"];
    source?: DocPage["source"];
    bookstackPageId?: string | null;
  },
  now = new Date(),
): Promise<DocPage> {
  const key = await docKey();
  const client = await db();
  const id = randomUUID();
  await client.execute({
    sql: `INSERT INTO doc_pages (id, customer_id, title, content, format, source, bookstack_page_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.customerId,
      seal(key, input.title.trim().slice(0, 200) || "Ohne Titel"),
      seal(key, input.content),
      input.format ?? "markdown",
      input.source ?? "app",
      input.bookstackPageId ?? null,
      now.toISOString(),
      now.toISOString(),
    ],
  });
  return (await getPage(id))!;
}

/** Speichert eine Seite; im Arbeitsplatz bearbeitete Seiten sind immer Markdown. */
export async function updatePage(
  id: string,
  fields: { title: string; content: string; format?: DocPage["format"] },
  now = new Date(),
): Promise<void> {
  const key = await docKey();
  const client = await db();
  await client.execute({
    sql: "UPDATE doc_pages SET title = ?, content = ?, format = ?, updated_at = ? WHERE id = ?",
    args: [
      seal(key, fields.title.trim().slice(0, 200) || "Ohne Titel"),
      seal(key, fields.content),
      fields.format ?? "markdown",
      now.toISOString(),
      id,
    ],
  });
}

export async function deletePage(id: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: "DELETE FROM doc_pages WHERE id = ?", args: [id] });
}

export async function pageByBookstackId(customerId: string, bookstackPageId: string): Promise<DocPage | null> {
  const key = await docKey();
  const client = await db();
  const result = await client.execute({
    sql: "SELECT * FROM doc_pages WHERE customer_id = ? AND bookstack_page_id = ?",
    args: [customerId, bookstackPageId],
  });
  return result.rows[0] ? toPage(result.rows[0], key) : null;
}

/** Passwörter gehören in Keeper – Hinweis, wenn eine Seite danach aussieht. */
export function looksLikeSecret(content: string): boolean {
  return /(passw(or)?t|kennwort|password|pwd|pin)\s*[:=]\s*\S{4,}/i.test(content);
}

// ── Patchschränke ──

export async function listRacks(customerId: string): Promise<Rack[]> {
  const key = await docKey();
  const client = await db();
  const racks = await client.execute({ sql: "SELECT * FROM racks WHERE customer_id = ?", args: [customerId] });
  const items = await client.execute({
    sql: `SELECT i.* FROM rack_items i JOIN racks r ON r.id = i.rack_id WHERE r.customer_id = ? ORDER BY i.unit_start DESC`,
    args: [customerId],
  });
  return racks.rows
    .map((row) => ({
      id: String(row.id),
      customerId: String(row.customer_id),
      name: unseal(key, row.name) ?? "",
      location: open(key, row.location),
      units: Number(row.units),
      notes: open(key, row.notes),
      items: items.rows
        .filter((i) => i.rack_id === row.id)
        .map((i) => ({
          id: String(i.id),
          rackId: String(i.rack_id),
          name: unseal(key, i.name) ?? "",
          kind: String(i.kind) as RackItemKind,
          unitStart: Number(i.unit_start),
          unitHeight: Number(i.unit_height),
          model: open(key, i.model),
          ip: open(key, i.ip),
          notes: open(key, i.notes),
        })),
    }))
    .sort((a, b) => byText(a.name, b.name));
}

export async function createRack(
  input: { customerId: string; name: string; location?: string | null; units: number; notes?: string | null },
  now = new Date(),
) {
  if (!Number.isInteger(input.units) || input.units < 1 || input.units > 60) throw new Error("Höhe bitte zwischen 1 und 60 HE");
  const key = await docKey();
  const client = await db();
  const id = randomUUID();
  await client.execute({
    sql: "INSERT INTO racks (id, customer_id, name, location, units, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      id,
      input.customerId,
      seal(key, input.name.trim().slice(0, 100) || "Patchschrank"),
      seal(key, clean(input.location)),
      input.units,
      seal(key, clean(input.notes, 2000)),
      now.toISOString(),
    ],
  });
  return id;
}

export async function deleteRack(id: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: "DELETE FROM racks WHERE id = ?", args: [id] });
}

/** Belegt Höheneinheiten im Schrank; meldet Überschneidungen und Platz außerhalb des Schranks. */
export async function addRackItem(
  input: {
    rackId: string;
    name: string;
    kind: RackItemKind;
    unitStart: number;
    unitHeight: number;
    model?: string | null;
    ip?: string | null;
    notes?: string | null;
  },
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = await docKey();
  const client = await db();
  const rack = (await client.execute({ sql: "SELECT units FROM racks WHERE id = ?", args: [input.rackId] })).rows[0];
  if (!rack) return { ok: false, error: "Schrank nicht gefunden" };
  const top = input.unitStart + input.unitHeight - 1;
  if (input.unitStart < 1 || input.unitHeight < 1 || top > Number(rack.units)) {
    return { ok: false, error: `Passt nicht: der Schrank hat ${rack.units} HE` };
  }
  const clash = (
    await client.execute({
      sql: "SELECT name FROM rack_items WHERE rack_id = ? AND unit_start <= ? AND unit_start + unit_height - 1 >= ?",
      args: [input.rackId, top, input.unitStart],
    })
  ).rows[0];
  if (clash) return { ok: false, error: `HE ${input.unitStart}–${top} überschneidet sich mit „${unseal(key, clash.name)}“` };
  await client.execute({
    sql: `INSERT INTO rack_items (id, rack_id, name, kind, unit_start, unit_height, model, ip, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      input.rackId,
      seal(key, input.name.trim().slice(0, 100)),
      input.kind,
      input.unitStart,
      input.unitHeight,
      seal(key, clean(input.model)),
      seal(key, clean(input.ip, 100)),
      seal(key, clean(input.notes, 1000)),
      now.toISOString(),
    ],
  });
  return { ok: true };
}

export async function deleteRackItem(id: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: "DELETE FROM rack_items WHERE id = ?", args: [id] });
}

// ── Patchliste ──

/** Natürliche Reihenfolge: PP1 Port 2 vor PP1 Port 10. */
const natural = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

export async function listPorts(customerId: string): Promise<PatchPort[]> {
  const key = await docKey();
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM patch_ports WHERE customer_id = ?", args: [customerId] });
  return result.rows
    .map((row) => toPort(row, key))
    .sort(
      (a, b) =>
        natural.compare(a.panel ?? "~", b.panel ?? "~") ||
        natural.compare(a.panelPort ?? "~", b.panelPort ?? "~") ||
        natural.compare(a.outlet ?? "~", b.outlet ?? "~"),
    );
}

export async function savePort(customerId: string, input: PatchInput, id?: string, now = new Date()): Promise<string> {
  const plain = PATCH_FIELDS.map(({ key }) => clean(input[key], key === "notes" ? 1000 : 200));
  if (plain.every((v) => v === null)) throw new Error("Bitte mindestens ein Feld ausfüllen");
  const vaultKey = await docKey();
  const values = plain.map((v) => seal(vaultKey, v));
  const client = await db();
  if (id) {
    await client.execute({
      sql: `UPDATE patch_ports SET ${PATCH_FIELDS.map(({ key }) => `${PATCH_COLUMNS[key]} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND customer_id = ?`,
      args: [...values, now.toISOString(), id, customerId],
    });
    return id;
  }
  const newId = randomUUID();
  await client.execute({
    sql: `INSERT INTO patch_ports (id, customer_id, ${PATCH_FIELDS.map(({ key }) => PATCH_COLUMNS[key]).join(", ")}, created_at, updated_at)
          VALUES (?, ?, ${PATCH_FIELDS.map(() => "?").join(", ")}, ?, ?)`,
    args: [newId, customerId, ...values, now.toISOString(), now.toISOString()],
  });
  return newId;
}

export async function deletePort(id: string): Promise<void> {
  const client = await db();
  await client.execute({ sql: "DELETE FROM patch_ports WHERE id = ?", args: [id] });
}

const HEADER_SYNONYMS: Record<keyof PatchInput, string[]> = {
  panel: ["patchfeld", "patchpanel", "panel", "pp", "verteiler", "patchfeldname"],
  panelPort: ["port", "patchport", "ppport", "patchfeldport", "panelport", "portnr", "portnummer"],
  outlet: ["dose", "datendose", "anschlussdose", "anschluss", "outlet", "auslass", "dosennr", "dosennummer"],
  room: ["raum", "zimmer", "ort", "standort", "room", "buero"],
  switchName: ["switch", "switchname", "sw"],
  switchPort: ["switchport", "swport", "switchanschluss", "switchportnr"],
  vlan: ["vlan", "vlanid", "netz"],
  device: ["gerat", "geraet", "endgerat", "endgeraet", "device", "client", "arbeitsplatz", "nutzer", "benutzer", "hostname"],
  cable: ["kabel", "farbe", "kabelfarbe", "lange", "laenge", "kategorie", "kat"],
  notes: ["bemerkung", "bemerkungen", "notiz", "notizen", "notes", "kommentar", "info"],
};

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");

/** Zerlegt CSV (Strichpunkt, Komma oder Tabulator, mit Anführungszeichen) in Zeilen und Felder. */
export function parseCsv(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", "\t", ","].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Patchliste aus einer Excel-/CSV-Datei: Spalten werden an ihren Überschriften erkannt. */
export function parsePatchCsv(input: string): { rows: PatchInput[]; mapped: string[]; ignored: string[] } {
  const [header, ...lines] = parseCsv(input);
  if (!header) return { rows: [], mapped: [], ignored: [] };
  const columns = header.map((name) => {
    const key = normalizeHeader(name);
    // „Switchport“ vor „Port“ prüfen, damit Ports richtig landen
    const match = (Object.entries(HEADER_SYNONYMS) as [keyof PatchInput, string[]][])
      .sort((a, b) => Math.max(...b[1].map((s) => s.length)) - Math.max(...a[1].map((s) => s.length)))
      .find(([, synonyms]) => synonyms.includes(key));
    return match?.[0] ?? null;
  });
  const used = new Set<keyof PatchInput>();
  const resolved = columns.map((key) => (key && !used.has(key) ? (used.add(key), key) : null));
  const rows = lines
    .map((cells) => {
      const entry = Object.fromEntries(PATCH_FIELDS.map(({ key }) => [key, null])) as PatchInput;
      resolved.forEach((key, i) => {
        if (key) entry[key] = cells[i]?.trim() || null;
      });
      return entry;
    })
    .filter((entry) => Object.values(entry).some((v) => v));
  return {
    rows,
    mapped: header.filter((_, i) => resolved[i]),
    ignored: header.filter((name, i) => !resolved[i] && name.trim()),
  };
}

export async function importPorts(customerId: string, rows: PatchInput[], now = new Date()): Promise<number> {
  let count = 0;
  for (const row of rows) {
    await savePort(customerId, row, undefined, now);
    count++;
  }
  return count;
}

const csvField = (value: string) => (/[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function portsCsv(ports: PatchPort[]): string {
  const lines = [
    PATCH_FIELDS.map((f) => f.label).join(";"),
    ...ports.map((p) => PATCH_FIELDS.map(({ key }) => csvField(p[key] ?? "")).join(";")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// ── Suche und Export ──

export type DocHit = {
  kind: "port" | "rack" | "page" | "network";
  customerId: string;
  customerName: string;
  title: string;
  detail: string;
  href: string;
};

export function describePort(p: PatchPort): string {
  return [
    p.panel || p.panelPort ? `Patchfeld ${[p.panel, p.panelPort].filter(Boolean).join(" Port ")}` : null,
    p.outlet ? `Dose ${p.outlet}` : null,
    p.room ? `Raum ${p.room}` : null,
    p.switchName || p.switchPort ? `Switch ${[p.switchName, p.switchPort].filter(Boolean).join(" Port ")}` : null,
    p.vlan ? `VLAN ${p.vlan}` : null,
    p.device ? `Gerät ${p.device}` : null,
    p.cable ? `Kabel ${p.cable}` : null,
    p.notes,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Durchsucht Patchlisten, Schränke, Doku-Seiten und Netzwerkgeräte – alle Kunden oder einen. */
export async function searchDocs(query: string, customerId?: string, limit = 30): Promise<DocHit[]> {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  if (words.length === 0) return [];
  // Die Inhalte sind verschlüsselt – gesucht wird nach dem Entschlüsseln (die Datenmengen je Betrieb sind klein).
  const key = await docKey();
  const client = await db();
  const scope = customerId ? "WHERE c.id = ?" : "";
  const args = customerId ? [customerId] : [];
  const matches = (...parts: (string | null | undefined)[]) => {
    const haystack = parts.filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => haystack.includes(w));
  };

  const hits: DocHit[] = [];
  const ports = await client.execute({
    sql: `SELECT p.*, c.name AS customer_name FROM patch_ports p JOIN customers c ON c.id = p.customer_id ${scope}`,
    args,
  });
  for (const row of ports.rows) {
    const port = toPort(row, key);
    if (!matches(describePort(port), port.panel, port.panelPort, String(row.customer_name))) continue;
    hits.push({
      kind: "port",
      customerId: port.customerId,
      customerName: String(row.customer_name),
      title: port.device || port.outlet || `${port.panel ?? ""} ${port.panelPort ?? ""}`.trim() || "Patchport",
      detail: describePort(port),
      href: `/app/kunden/${port.customerId}/doku?tab=verkabelung`,
    });
  }

  const items = await client.execute({
    sql: `SELECT i.*, r.name AS rack_name, c.id AS customer_id, c.name AS customer_name FROM rack_items i JOIN racks r ON r.id = i.rack_id
          JOIN customers c ON c.id = r.customer_id ${scope}`,
    args,
  });
  for (const row of items.rows) {
    const [name, model, ip, notes, rackName] = [row.name, row.model, row.ip, row.notes, row.rack_name].map((v) => open(key, v));
    if (!matches(name, model, ip, notes, rackName, String(row.customer_name))) continue;
    const units =
      Number(row.unit_height) > 1 ? `${row.unit_start}–${Number(row.unit_start) + Number(row.unit_height) - 1}` : String(row.unit_start);
    hits.push({
      kind: "rack",
      customerId: String(row.customer_id),
      customerName: String(row.customer_name),
      title: name ?? "Gerät",
      detail: [`${rackName}, HE ${units}`, model, ip, notes].filter(Boolean).join(" · "),
      href: `/app/kunden/${row.customer_id}/doku?tab=schrank`,
    });
  }

  const snippet = (content: string) => {
    const lower = content.toLowerCase();
    const at = Math.max(0, lower.indexOf(words[0]) - 60);
    // Markdown-Zeichen (Tabellenstriche, Rauten, Sternchen) stören im Ausschnitt
    const plain = content
      .slice(at, at + 220)
      .replace(/\|?\s*-{3,}\s*\|?/g, " ")
      .replace(/[|#*`>]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `${at > 0 ? "…" : ""}${plain.slice(0, 180)}…`;
  };
  const pages = await client.execute({
    sql: `SELECT d.*, c.name AS customer_name FROM doc_pages d JOIN customers c ON c.id = d.customer_id ${scope}`,
    args,
  });
  for (const row of pages.rows) {
    const page = toPage(row, key);
    const content = page.format === "html" ? page.content.replace(/<[^>]+>/g, " ") : page.content;
    if (!matches(page.title, content, String(row.customer_name))) continue;
    hits.push({
      kind: "page",
      customerId: page.customerId,
      customerName: String(row.customer_name),
      title: page.title,
      detail: snippet(content),
      href: `/app/kunden/${page.customerId}/doku/${page.id}`,
    });
  }

  const networks = await client.execute({
    sql: `SELECT n.*, c.name AS customer_name FROM network_models n JOIN customers c ON c.id = n.customer_id ${scope}`,
    args,
  });
  for (const row of networks.rows) {
    const model = JSON.parse(unseal(key, row.data) ?? "{}") as {
      devices?: { id: string; name: string; vendor?: string; model?: string; ip?: string; location?: string; notes?: string }[];
    };
    for (const device of model.devices ?? []) {
      if (!matches(device.name, device.vendor, device.model, device.ip, device.location, device.notes, String(row.customer_name))) continue;
      hits.push({
        kind: "network",
        customerId: String(row.customer_id),
        customerName: String(row.customer_name),
        title: device.name,
        detail: [[device.vendor, device.model].filter(Boolean).join(" "), device.ip, device.location, device.notes]
          .filter(Boolean)
          .join(" · "),
        href: `/app/kunden/${row.customer_id}/doku/netzwerk`,
      });
    }
  }
  return hits.slice(0, limit);
}

/** Verschlüsselt alle noch unverschlüsselten Doku-Daten (beim Einrichten des Tresors). */
export async function encryptExistingDocs(key: Buffer): Promise<number> {
  const client = await db();
  const tables: [string, string[]][] = [
    ["doc_pages", ["title", "content"]],
    ["racks", ["name", "location", "notes"]],
    ["rack_items", ["name", "model", "ip", "notes"]],
    ["patch_ports", ["panel", "panel_port", "outlet", "room", "switch_name", "switch_port", "vlan", "device", "cable", "notes"]],
    ["network_models", ["data"]],
  ];
  let count = 0;
  for (const [table, columns] of tables) {
    const id = table === "network_models" ? "customer_id" : "id";
    const rows = (await client.execute(`SELECT ${id} AS row_id, ${columns.join(", ")} FROM ${table}`)).rows;
    for (const row of rows) {
      const values = columns.map((column) =>
        row[column] === null || isSealed(row[column]) ? row[column] : seal(key, String(row[column])),
      );
      await client.execute({
        sql: `UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE ${id} = ?`,
        args: [...(values as (string | null)[]), String(row.row_id)],
      });
      count++;
    }
  }
  return count;
}

const cell = (value: string | number | null | undefined) =>
  String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");

/** Patchschränke und Patchliste als Markdown – für die Veröffentlichung in BookStack. */
export function cablingMarkdown(customerName: string, racks: Rack[], ports: PatchPort[], now = new Date()): string {
  const stamp = new Intl.DateTimeFormat("de-AT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Vienna" }).format(now);
  const parts = [
    `Automatisch aus dem Arbeitsplatz erzeugt (${stamp}). Änderungen bitte dort vornehmen – diese Seite wird überschrieben.`,
    "",
  ];
  for (const rack of racks) {
    parts.push(`## Patchschrank ${rack.name}${rack.location ? ` (${rack.location})` : ""} – ${rack.units} HE`, "");
    if (rack.notes) parts.push(rack.notes, "");
    parts.push("| HE | Gerät | Art | Modell | IP | Notiz |", "|---|---|---|---|---|---|");
    for (const item of rack.items) {
      const units = item.unitHeight > 1 ? `${item.unitStart + item.unitHeight - 1}–${item.unitStart}` : String(item.unitStart);
      parts.push(
        `| ${units} | ${cell(item.name)} | ${RACK_ITEM_KINDS[item.kind] ?? item.kind} | ${cell(item.model)} | ${cell(item.ip)} | ${cell(item.notes)} |`,
      );
    }
    parts.push("");
  }
  parts.push(`## Patchliste (${ports.length} Anschlüsse)`, "");
  parts.push(`| ${PATCH_FIELDS.map((f) => f.label).join(" | ")} |`, `|${PATCH_FIELDS.map(() => "---").join("|")}|`);
  for (const port of ports) parts.push(`| ${PATCH_FIELDS.map(({ key }) => cell(port[key])).join(" | ")} |`);
  return `# Verkabelung und Patchschrank – ${customerName}\n\n${parts.join("\n")}\n`;
}
