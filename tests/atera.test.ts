import { mkdtempSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Nachgebaute Atera-API v3 (Paging mit page/itemsInPage, Schlüssel im Header X-API-KEY)
const requests: { method: string; url: string; headers: IncomingHttpHeaders; body: unknown }[] = [];
const state = {
  customers: Array.from({ length: 55 }, (_, i) => ({
    CustomerID: i + 1,
    CustomerName: i === 0 ? "Huber Steuerberatung" : `Kunde ${i + 1}`,
  })),
  tickets: [
    {
      TicketID: 101,
      TicketTitle: "Drucker im 2. Stock druckt nicht",
      TicketStatus: "Open",
      TicketPriority: "High",
      TicketType: "Incident",
      CustomerID: 1,
      CustomerName: "Huber Steuerberatung",
      EndUserFirstName: "Maria",
      EndUserLastName: "Huber",
      EndUserEmail: "maria.huber@huber-stb.example",
      TicketCreatedDate: "2026-11-16T08:00:00Z",
      LastEndUserCommentTimestamp: "2026-11-17T07:30:00Z",
      LastTechnicianCommentTimestamp: "2026-11-16T09:00:00Z",
    },
    {
      TicketID: 102,
      TicketTitle: "Neuer Mitarbeiter: Notebook einrichten",
      TicketStatus: "Pending",
      TicketPriority: "Medium",
      CustomerID: 2,
      CustomerName: "Kunde 2",
      TicketCreatedDate: "2026-11-15T08:00:00Z",
    },
  ] as Record<string, unknown>[],
  alerts: [
    {
      AlertID: 9001,
      Title: "Festplatte C: unter 5 % frei",
      Severity: "Critical",
      DeviceName: "SRV-DC01",
      CustomerID: 1,
      CustomerName: "Huber Steuerberatung",
      Created: "2026-11-17T06:00:00Z",
      Archived: false,
    },
    { AlertID: 9002, Title: "Alte Warnung", Severity: "Warning", CustomerID: 1, Archived: true },
  ],
  agents: [
    { AgentID: 1, CustomerID: 1, CustomerName: "Huber Steuerberatung", MachineName: "SRV-DC01", OS: "Windows Server 2022", Online: true },
    {
      AgentID: 2,
      CustomerID: 1,
      CustomerName: "Huber Steuerberatung",
      MachineName: "PC-EMPFANG",
      OS: "Windows 11 Pro",
      Online: false,
      LastSeen: "2026-11-14T16:00:00Z",
    },
  ],
  singleTickets: { 100: { TicketID: 100, TicketTitle: "Altes Ticket", TicketStatus: "Resolved", CustomerID: 1 } } as Record<
    string,
    unknown
  >,
  comments: [
    {
      Date: "2026-11-16T08:00:00Z",
      Comment: "<p>Der Drucker zeigt <b>Papierstau</b>, ist aber leer.</p>",
      EnduserID: 7,
      FirstName: "Maria",
      LastName: "Huber",
    },
    {
      Date: "2026-11-16T09:00:00Z",
      Comment: "Treiber neu installiert.",
      TechnicianContactID: 3,
      FirstName: "Max",
      LastName: "Muster",
      IsInternal: true,
    },
  ],
};

function page<T>(items: T[], url: URL) {
  const pageNo = Number(url.searchParams.get("page") ?? 1);
  const size = Number(url.searchParams.get("itemsInPage") ?? 20);
  return {
    items: items.slice((pageNo - 1) * size, pageNo * size),
    page: pageNo,
    itemsInPage: size,
    totalItemCount: items.length,
    totalPages: Math.ceil(items.length / size),
  };
}

const atera: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url!, "http://atera");
    requests.push({ method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-api-key"] !== "atera-key") return json(401, { message: "unauthorized" });
    const path = url.pathname.replace(/^\/api\/v3/, "");
    if (path === "/customers") return json(200, page(state.customers, url));
    if (path === "/tickets")
      return json(
        200,
        page(
          state.tickets.filter((t) => t.TicketStatus === url.searchParams.get("ticketStatus")),
          url,
        ),
      );
    if (path === "/alerts") return json(200, page(state.alerts, url));
    if (path === "/agents") return json(200, page(state.agents, url));
    const ticket = path.match(/^\/tickets\/(\d+)(\/comments)?$/);
    if (ticket && ticket[2]) return json(200, page(state.comments, url));
    if (ticket && req.method === "PUT") return json(200, { ActionID: 1 });
    if (ticket) return state.singleTickets[ticket[1]] ? json(200, state.singleTickets[ticket[1]]) : json(404, { message: "not found" });
    json(404, { message: `unbekannt ${path}` });
  });
});

let sync: typeof import("@/lib/workspace/atera-sync");
let customers: typeof import("@/lib/workspace/customers");
let client: typeof import("@/lib/atera");
let db: typeof import("@/lib/db");

beforeAll(async () => {
  await new Promise<void>((resolve) => atera.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, {
    DATABASE_URL: `file:${path.join(mkdtempSync(path.join(tmpdir(), "atera-")), "test.db")}`,
    ATERA_API_URL: `http://127.0.0.1:${(atera.address() as AddressInfo).port}/api/v3`,
    ATERA_API_KEY: "atera-key",
  });
  sync = await import("@/lib/workspace/atera-sync");
  customers = await import("@/lib/workspace/customers");
  client = await import("@/lib/atera");
  db = await import("@/lib/db");
});
afterAll(() => new Promise<void>((resolve) => atera.close(() => resolve())));

describe("Atera-Abgleich", () => {
  it("spiegelt Kunden (mit Paging), offene Tickets, aktive Warnungen und Geräte", async () => {
    // Ein bei uns noch offenes Ticket, das in Atera inzwischen gelöst ist
    const c = await db.db();
    await c.execute(
      "INSERT INTO tickets (id, title, status, synced_at) VALUES ('100', 'Altes Ticket', 'Open', '2026-11-10T00:00:00Z'), ('99', 'Gelöschtes Ticket', 'Open', '2026-11-10T00:00:00Z')",
    );

    const result = await sync.syncAtera(new Date("2026-11-17T08:00:00Z"));
    expect(result).toEqual({ customers: 55, tickets: 2, closed: 2, alerts: 1, devices: 2 });
    expect(requests.every((r) => r.headers["x-api-key"] === "atera-key")).toBe(true);
    expect(
      requests.filter((r) => r.url.startsWith("/api/v3/customers")).map((r) => new URL(r.url, "http://x").searchParams.get("page")),
    ).toEqual(["1", "2"]);

    const huber = (await customers.findCustomer("huber"))!;
    expect(huber).toMatchObject({ name: "Huber Steuerberatung", ateraId: "1" });
    const tickets = await customers.listTickets();
    expect(tickets.map((t) => t.id)).toEqual(["101", "102"]);
    expect(tickets[0]).toMatchObject({
      customerId: huber.id,
      priority: "High",
      contactName: "Maria Huber",
      // Kunde hat zuletzt geschrieben → Ball liegt bei uns
      waitingForUs: true,
    });
    expect(tickets[1].waitingForUs).toBe(false); // Wartend (Pending) zählt nicht
    expect((await customers.getTicket("100"))!.status).toBe("Resolved");
    expect((await customers.getTicket("99"))!.status).toBe("Closed");

    const alerts = await customers.listAlerts(huber.id);
    expect(alerts).toEqual([
      expect.objectContaining({ title: "Festplatte C: unter 5 % frei", severity: "Critical", deviceName: "SRV-DC01" }),
    ]);
    const devices = await customers.listDevices(huber.id);
    expect(devices.map((d) => [d.name, d.online])).toEqual([
      ["PC-EMPFANG", false],
      ["SRV-DC01", true],
    ]);
    const overview = (await customers.listCustomers()).find((x) => x.id === huber.id)!;
    expect(overview).toMatchObject({ openTickets: 1, alerts: 1, devices: 2, offline: 1 });
  });

  it("behält eigene Angaben beim nächsten Abgleich", async () => {
    const huber = (await customers.findCustomer("Huber Steuerberatung"))!;
    await customers.updateCustomer(huber.id, {
      keeperUrl: "https://keepersecurity.eu/vault/#detail/abc",
      domains: ["@huber-stb.example"],
      email: "office@huber-stb.example",
    });
    state.customers[0].CustomerName = "Huber Steuerberatung GmbH";
    await sync.syncAtera();
    const after = (await customers.getCustomer(huber.id))!;
    expect(after).toMatchObject({
      name: "Huber Steuerberatung GmbH",
      keeperUrl: "https://keepersecurity.eu/vault/#detail/abc",
      domains: ["huber-stb.example"],
    });
    // Zuordnung über die E-Mail-Domain
    expect((await customers.findCustomer("maria@huber-stb.example"))?.id).toBe(huber.id);
  });

  it("liest den Verlauf ohne HTML und ändert den Status", async () => {
    const comments = await client.ateraTicketComments("101");
    expect(comments).toEqual([
      {
        date: "2026-11-16T08:00:00Z",
        author: "Maria Huber",
        text: "Der Drucker zeigt Papierstau, ist aber leer.",
        fromCustomer: true,
        internal: false,
      },
      { date: "2026-11-16T09:00:00Z", author: "Max Muster", text: "Treiber neu installiert.", fromCustomer: false, internal: true },
    ]);
    await client.updateAteraTicketStatus("101", "Pending");
    expect(requests.at(-1)).toMatchObject({ method: "PUT", url: "/api/v3/tickets/101", body: { TicketStatus: "Pending" } });
  });

  it("meldet einen ungültigen Schlüssel verständlich", async () => {
    process.env.ATERA_API_KEY = "falsch";
    await expect(client.listAteraCustomers()).rejects.toThrow("Atera lehnt den API-Schlüssel ab");
    process.env.ATERA_API_KEY = "atera-key";
  });
});
