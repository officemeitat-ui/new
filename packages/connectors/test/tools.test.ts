import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listTicketComments, listTickets, testAtera } from "../src/atera";
import { exportPageMarkdown, listBooks, listPages, pageUrl } from "../src/bookstack";
import { assertSafeBaseUrl, ConnectorError, getText, isPrivateAddress } from "../src/http";
import {
  MOCK_ATERA_KEY,
  MOCK_BOOKSTACK_TOKEN,
  startMockTools,
  type MockTools,
} from "../src/testing/mock-tools";

let mock: MockTools;
beforeAll(async () => {
  mock = await startMockTools({ pageSize: 1 });
});
afterAll(() => mock.close());

const bookstack = () => ({
  baseUrl: mock.bookstackUrl,
  tokenId: MOCK_BOOKSTACK_TOKEN.id,
  tokenSecret: MOCK_BOOKSTACK_TOKEN.secret,
  allowPrivate: true,
});

describe("BookStack connector", () => {
  it("pages through books and pages, skips drafts and exports markdown", async () => {
    expect((await listBooks(bookstack())).map((b) => b.slug)).toEqual(["firewalls", "clients"]);
    const pages = await listPages(bookstack());
    expect(pages.map((p) => p.name)).toEqual([
      "Securepoint Firmware-Update",
      "Lenovo Docking Station",
    ]);
    // Page size 1 in the mock: every entry is its own request.
    expect(mock.calls.filter((c) => c.path.startsWith("/bookstack/api/pages?")).length).toBe(3);
    expect(await exportPageMarkdown(bookstack(), 12)).toContain("Lenovo Vantage");
    expect(pageUrl("https://doku.example", "clients", "lenovo-docking-station")).toBe(
      "https://doku.example/books/clients/page/lenovo-docking-station",
    );
  });

  it("reports rejected tokens clearly", async () => {
    await expect(listPages({ ...bookstack(), tokenSecret: "falsch" })).rejects.toThrow(
      "BookStack hat die Zugangsdaten abgelehnt.",
    );
  });
});

describe("Atera connector", () => {
  const atera = () => ({ apiKey: MOCK_ATERA_KEY, baseUrl: mock.ateraUrl });

  it("lists tickets page by page with status and date filter, and reads comments", async () => {
    const first = await listTickets(atera(), { status: "Resolved", page: 1 });
    expect(first.tickets.map((t) => t.TicketTitle)).toEqual(["HP-Drucker druckt nur leere Seiten"]);
    expect(first.hasMore).toBe(false);
    const closed = await listTickets(atera(), {
      status: "Closed",
      page: 1,
      dateFrom: "2000-01-01",
    });
    expect(closed.tickets[0]).toMatchObject({
      TicketID: 502,
      CustomerName: "Kanzlei Berger & Partner",
    });
    expect(mock.calls.at(-1)!.path).toContain("DateFrom=2000-01-01");
    const comments = await listTicketComments(atera(), 501);
    expect(comments).toHaveLength(2);
    expect(comments[1]).toMatchObject({ internal: true });
    expect(comments[1]!.text).toContain("Schutzstreifen");
  });

  it("rejects a wrong key", async () => {
    await expect(testAtera({ ...atera(), apiKey: "falsch" })).rejects.toBeInstanceOf(
      ConnectorError,
    );
  });
});

describe("SSRF protection for customer-entered addresses", () => {
  it("allows public https addresses only", async () => {
    expect(await assertSafeBaseUrl("https://93.184.215.14/wiki/")).toBe(
      "https://93.184.215.14/wiki",
    );
    await expect(assertSafeBaseUrl("http://93.184.215.14")).rejects.toThrow(/https/);
    await expect(assertSafeBaseUrl("https://127.0.0.1")).rejects.toThrow(/Interne/);
    await expect(assertSafeBaseUrl("https://10.0.0.5")).rejects.toThrow(/Interne/);
    await expect(assertSafeBaseUrl("https://localhost")).rejects.toThrow(/Interne/);
    await expect(assertSafeBaseUrl("https://user:pw@doku.example")).rejects.toThrow(/Zugangsdaten/);
    await expect(assertSafeBaseUrl("kein url")).rejects.toThrow(/vollständige/);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:192.168.1.1")).toBe(true);
    expect(isPrivateAddress("fd12::1")).toBe(true);
    expect(isPrivateAddress("2a01:4f8::1")).toBe(false);
    // Other spellings of internal addresses.
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:a9fe:a9fe")).toBe(true);
    expect(isPrivateAddress("64:ff9b::7f00:1")).toBe(true);
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
    expect(isPrivateAddress("::ffff:808:808")).toBe(false);
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    // WHATWG URL parsing turns decimal and hex hosts into dotted IPv4 first.
    await expect(assertSafeBaseUrl("https://2130706433")).rejects.toThrow(/Interne/);
    await expect(assertSafeBaseUrl("https://0x7f.1")).rejects.toThrow(/Interne/);
    await expect(assertSafeBaseUrl("https://[::ffff:127.0.0.1]")).rejects.toThrow(/Interne/);
  });

  it("checks the address again when the connection is made (DNS rebinding)", async () => {
    const options = { service: "BookStack", headers: {}, publicOnly: true };
    // Even if a name resolved to a public address during the check, the connection itself
    // resolves again and refuses private targets.
    await expect(getText("https://localhost:9/api/pages", options)).rejects.toThrow(/Interne/);
    await expect(getText("https://127.0.0.1:9/api/pages", options)).rejects.toThrow(/Interne/);
    await expect(getText("https://[::1]:9/api/pages", options)).rejects.toThrow(/Interne/);
    await expect(getText("https://[::ffff:7f00:1]:9/api/pages", options)).rejects.toThrow(
      /Interne/,
    );
    await expect(getText("http://93.184.215.14/api/pages", options)).rejects.toThrow(/https/);
  });
});
