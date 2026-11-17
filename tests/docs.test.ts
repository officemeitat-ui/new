import { mkdtempSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/workspace/markdown";

// Kunden-Doku und BookStack (nachgebaute REST-API mit Token-Anmeldung).
const calls: { method: string; url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> | null }[] = [];
const bookstackPages: Record<number, Record<string, unknown>> = {
  11: {
    id: 11,
    book_id: 5,
    chapter_id: 0,
    name: "Netzwerk",
    slug: "netzwerk",
    markdown: "## VLANs\n\n| VLAN | Netz |\n|---|---|\n| 20 | 192.168.20.0/24 |",
    html: "<h2>VLANs</h2>",
  },
  12: { id: 12, book_id: 5, chapter_id: 0, name: "Server", slug: "server", markdown: "", html: "<p>DC01 auf <b>Hyper-V</b></p>" },
  13: { id: 13, book_id: 5, chapter_id: 0, name: "Entwurf", slug: "entwurf", draft: true },
};
let nextPageId = 50;
const bookstack: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url!, "http://bs");
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method!, url: req.url!, headers: req.headers, body });
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.headers.authorization !== "Token tid:tsecret") return json(401, { error: { message: "No authorization token found" } });
    if (url.pathname === "/api/books") return json(200, { data: [{ id: 5, name: "Huber Steuerberatung", slug: "huber" }], total: 1 });
    if (url.pathname === "/api/pages" && req.method === "GET") {
      const book = url.searchParams.get("filter[book_id]");
      return json(200, { data: Object.values(bookstackPages).filter((p) => String(p.book_id) === book) });
    }
    if (url.pathname === "/api/pages" && req.method === "POST") {
      const page = { id: nextPageId++, ...body };
      bookstackPages[page.id] = page;
      return json(200, page);
    }
    const match = url.pathname.match(/^\/api\/pages\/(\d+)$/);
    if (match) {
      const page = bookstackPages[Number(match[1])];
      if (!page) return json(404, { error: { message: "Page not found" } });
      if (req.method === "PUT") Object.assign(page, body);
      return json(200, page);
    }
    if (url.pathname === "/api/search") {
      return json(200, {
        data: [
          {
            type: "page",
            id: 11,
            name: "Netzwerk",
            url: "https://wiki.example/books/huber/page/netzwerk",
            preview_html: { content: "VLAN <b>20</b>" },
          },
        ],
      });
    }
    json(404, { error: { message: "unknown" } });
  });
});

let docs: typeof import("@/lib/workspace/docs");
let customers: typeof import("@/lib/workspace/customers");
let bs: typeof import("@/lib/bookstack");
let sync: typeof import("@/lib/workspace/bookstack-sync");
let huber: string;
let gruber: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => bookstack.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, {
    DATABASE_URL: `file:${path.join(mkdtempSync(path.join(tmpdir(), "docs-")), "test.db")}`,
    BOOKSTACK_URL: `http://127.0.0.1:${(bookstack.address() as AddressInfo).port}/`,
    BOOKSTACK_TOKEN_ID: "tid",
    BOOKSTACK_TOKEN_SECRET: "tsecret",
  });
  docs = await import("@/lib/workspace/docs");
  customers = await import("@/lib/workspace/customers");
  bs = await import("@/lib/bookstack");
  sync = await import("@/lib/workspace/bookstack-sync");
  huber = (await customers.createCustomer({ name: "Huber Steuerberatung" })).id;
  gruber = (await customers.createCustomer({ name: "Bäckerei Gruber" })).id;
});
afterAll(() => new Promise<void>((resolve) => bookstack.close(() => resolve())));

const EXCEL = [
  "Patchfeld;Port;Dose;Raum;Switch;Switchport;VLAN;Gerät;Farbe;Bemerkung;Inventar",
  'PP1;10;2.10;Büro 2;SW-Core;Gi1/0/10;20;PC Leitner;blau;"Dose hinter Schrank; schwer erreichbar";INV-1',
  "PP1;2;1.02;Empfang;SW-Core;Gi1/0/2;20;PC Empfang;blau;;INV-2",
  "PP2;1;2.14;Kopierraum;SW-Core;Gi1/0/25;30;Drucker 2. Stock;gelb;;",
  ";;;;;;;;;;",
].join("\r\n");

describe("Patchliste", () => {
  it("übernimmt eine Excel-Liste anhand der Überschriften und sortiert natürlich", async () => {
    const parsed = docs.parsePatchCsv(EXCEL);
    expect(parsed.mapped).toEqual(["Patchfeld", "Port", "Dose", "Raum", "Switch", "Switchport", "VLAN", "Gerät", "Farbe", "Bemerkung"]);
    expect(parsed.ignored).toEqual(["Inventar"]);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]).toMatchObject({
      switchPort: "Gi1/0/10",
      panelPort: "10",
      notes: "Dose hinter Schrank; schwer erreichbar",
      cable: "blau",
    });

    expect(await docs.importPorts(huber, parsed.rows)).toBe(3);
    const ports = await docs.listPorts(huber);
    expect(ports.map((p) => `${p.panel}/${p.panelPort}`)).toEqual(["PP1/2", "PP1/10", "PP2/1"]);
  });

  it("versteht auch Komma, Tabulator und Zeilenumbrüche in Anführungszeichen", () => {
    expect(docs.parseCsv('a,b\n"x, y","mehr\nzeilig"')).toEqual([
      ["a", "b"],
      ["x, y", "mehr\nzeilig"],
    ]);
    expect(docs.parseCsv("Dose\tRaum\n1.01\tEmpfang")).toEqual([
      ["Dose", "Raum"],
      ["1.01", "Empfang"],
    ]);
    expect(docs.parsePatchCsv("Inventar;Seriennummer\n1;2").mapped).toEqual([]);
  });

  it("bearbeitet Anschlüsse und exportiert sie wieder als CSV", async () => {
    const [first] = await docs.listPorts(huber);
    await docs.savePort(huber, { ...first, device: "PC Empfang (neu)" }, first.id);
    expect((await docs.listPorts(huber))[0].device).toBe("PC Empfang (neu)");
    await expect(docs.savePort(huber, Object.fromEntries(docs.PATCH_FIELDS.map((f) => [f.key, " "])) as never)).rejects.toThrow(
      "mindestens ein Feld",
    );
    const csv = docs.portsCsv(await docs.listPorts(huber));
    expect(csv.replace(/^\uFEFF/, "").split("\r\n")[0]).toBe("Patchfeld;Port;Dose;Raum;Switch;Switchport;VLAN;Gerät;Kabel;Notiz");
    expect(csv).toContain('PP1;10;2.10;Büro 2;SW-Core;Gi1/0/10;20;PC Leitner;blau;"Dose hinter Schrank; schwer erreichbar"');
    // und lässt sich ohne Verluste wieder einlesen
    expect(docs.parsePatchCsv(csv).rows[1]).toMatchObject({ device: "PC Leitner", notes: "Dose hinter Schrank; schwer erreichbar" });
  });
});

describe("Patchschrank", () => {
  it("belegt Höheneinheiten und verhindert Überschneidungen", async () => {
    const rack = await docs.createRack({ customerId: huber, name: "Serverschrank", location: "Keller", units: 12 });
    expect(await docs.addRackItem({ rackId: rack, name: "PP1", kind: "patchpanel", unitStart: 12, unitHeight: 1 })).toEqual({ ok: true });
    expect(
      await docs.addRackItem({ rackId: rack, name: "SW-Core", kind: "switch", unitStart: 11, unitHeight: 1, ip: "192.168.10.2" }),
    ).toEqual({ ok: true });
    expect(await docs.addRackItem({ rackId: rack, name: "USV", kind: "usv", unitStart: 1, unitHeight: 2 })).toEqual({ ok: true });
    expect(await docs.addRackItem({ rackId: rack, name: "Server", kind: "server", unitStart: 2, unitHeight: 2 })).toEqual({
      ok: false,
      error: "HE 2–3 überschneidet sich mit „USV“",
    });
    expect(await docs.addRackItem({ rackId: rack, name: "Zu hoch", kind: "server", unitStart: 12, unitHeight: 2 })).toEqual({
      ok: false,
      error: "Passt nicht: der Schrank hat 12 HE",
    });
    await expect(docs.createRack({ customerId: huber, name: "x", units: 0 })).rejects.toThrow("zwischen 1 und 60");
    const [stored] = await docs.listRacks(huber);
    expect(stored.items.map((i) => [i.name, i.unitStart])).toEqual([
      ["PP1", 12],
      ["SW-Core", 11],
      ["USV", 1],
    ]);
  });
});

describe("Seiten und Suche", () => {
  it("findet Geräte, Ports, Schrankinhalte und Seiten – auch kundenübergreifend", async () => {
    await docs.createPage({
      customerId: huber,
      title: "Datensicherung",
      content: docs.PAGE_TEMPLATES.Datensicherung + "\nVeeam auf NAS im Keller",
    });
    await docs.importPorts(gruber, [{ ...docs.parsePatchCsv(EXCEL).rows[2], device: "Kasse 2" }]);

    const printer = await docs.searchDocs("drucker 2. stock");
    expect(printer).toEqual([expect.objectContaining({ kind: "port", customerName: "Huber Steuerberatung", title: "Drucker 2. Stock" })]);
    expect(printer[0].detail).toContain("Switch SW-Core Port Gi1/0/25");

    expect((await docs.searchDocs("192.168.10.2"))[0]).toMatchObject({
      kind: "rack",
      title: "SW-Core",
      detail: expect.stringContaining("HE 11"),
    });
    expect((await docs.searchDocs("veeam"))[0]).toMatchObject({ kind: "page", title: "Datensicherung" });
    // Eingrenzen auf einen Kunden
    expect((await docs.searchDocs("Gi1/0/25")).length).toBe(2);
    expect((await docs.searchDocs("Gi1/0/25", gruber)).map((h) => h.customerName)).toEqual(["Bäckerei Gruber"]);
  });

  it("warnt vor Passwörtern und stellt Markdown sicher dar", () => {
    expect(docs.looksLikeSecret("Admin-Passwort: Geheim123!")).toBe(true);
    expect(docs.looksLikeSecret("Passwörter liegen in Keeper")).toBe(false);
    const html = renderMarkdown(
      "# Netz\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) [Wiki](https://wiki.example)\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    );
    expect(html).toContain("<h1>Netz</h1>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="https://wiki.example" target="_blank" rel="noreferrer">Wiki</a>');
    expect(html).toContain("<table>");
  });

  it("baut die Verkabelungsseite als Markdown mit Tabellen", async () => {
    const markdown = docs.cablingMarkdown(
      "Huber",
      await docs.listRacks(huber),
      await docs.listPorts(huber),
      new Date("2026-11-17T10:00:00Z"),
    );
    expect(markdown).toContain("## Patchschrank Serverschrank (Keller) – 12 HE");
    expect(markdown).toContain("| 2–1 | USV | USV |");
    expect(markdown).toContain("## Patchliste (3 Anschlüsse)");
    expect(markdown).toContain("| PP2 | 1 | 2.14 | Kopierraum | SW-Core | Gi1/0/25 | 30 | Drucker 2. Stock | gelb |  |");
  });
});

describe("BookStack", () => {
  it("meldet sich mit Token an und listet Bücher und Seiten ohne Entwürfe", async () => {
    expect(await bs.listBooks()).toEqual([{ id: 5, name: "Huber Steuerberatung", slug: "huber" }]);
    expect(calls[0].headers.authorization).toBe("Token tid:tsecret");
    expect((await bs.listBookPages(5)).map((p) => p.name)).toEqual(["Netzwerk", "Server"]);
    expect(calls.at(-1)!.url).toContain("filter%5Bbook_id%5D=5");
    expect(bs.bookstackUrl("/books/huber")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/books\/huber$/);
  });

  it("veröffentlicht die Verkabelung, aktualisiert sie danach und legt sie neu an, wenn sie gelöscht wurde", async () => {
    await customers.setCustomerBookstack(huber, { bookId: "5" });
    const first = await sync.publishCablingToBookstack((await customers.getCustomer(huber))!);
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: "/api/pages", body: { book_id: 5, name: "Verkabelung und Patchschrank" } });
    expect((await customers.getCustomer(huber))!.bookstackPageId).toBe(String(first));

    await sync.publishCablingToBookstack((await customers.getCustomer(huber))!);
    expect(calls.at(-1)).toMatchObject({ method: "PUT", url: `/api/pages/${first}` });

    delete bookstackPages[first];
    const second = await sync.publishCablingToBookstack((await customers.getCustomer(huber))!);
    expect(second).not.toBe(first);
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: "/api/pages" });
  });

  it("übernimmt Seiten (Markdown bleibt Markdown, HTML wird abgeschottet gezeigt) und aktualisiert sie beim zweiten Mal", async () => {
    const customer = (await customers.getCustomer(huber))!;
    expect(await sync.importPagesFromBookstack(customer)).toEqual({ created: 2, updated: 0 });
    const pages = await docs.listPages(huber);
    expect(pages.find((p) => p.title === "Netzwerk")).toMatchObject({ format: "markdown", source: "bookstack", bookstackPageId: "11" });
    expect(pages.find((p) => p.title === "Server")).toMatchObject({ format: "html", content: "<p>DC01 auf <b>Hyper-V</b></p>" });
    // Die eigene Verkabelungsseite wird nicht zurück übernommen
    expect(pages.some((p) => p.title === "Verkabelung und Patchschrank")).toBe(false);

    bookstackPages[11].markdown = "## VLANs\n\nAktualisiert";
    expect(await sync.importPagesFromBookstack(customer)).toEqual({ created: 0, updated: 2 });
    expect((await docs.listPages(huber)).find((p) => p.title === "Netzwerk")!.content).toBe("## VLANs\n\nAktualisiert");
  });

  it("sucht in BookStack und meldet einen falschen Token verständlich", async () => {
    expect((await bs.searchBookStack("VLAN"))[0]).toMatchObject({
      name: "Netzwerk",
      url: "https://wiki.example/books/huber/page/netzwerk",
    });
    process.env.BOOKSTACK_TOKEN_SECRET = "falsch";
    await expect(bs.listBooks()).rejects.toThrow("BookStack lehnt den API-Token ab");
    process.env.BOOKSTACK_TOKEN_SECRET = "tsecret";
  });
});
