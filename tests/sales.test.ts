import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eolStatus } from "@/lib/lifecycle";

process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "sales-")), "test.db")}`;
process.env.SESSION_SECRET = "test-session-geheimnis";
process.env.ANTHROPIC_API_KEY = "test";

const claudeBodies: { system: unknown; messages: { content: unknown }[] }[] = [];
// Nachgebautes Claude: wählt Leistungen und schreibt den Text – mit absichtlich falscher Menge „0“ bei SEC.
const claude: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    claudeBodies.push(JSON.parse(raw));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              titel: "Sicher und planbar",
              einleitung: "danke für das Gespräch.",
              positionen: [
                { code: "MW", begruendung: "Flatrate" },
                { code: "SEC", menge: 0, begruendung: "Schutz" },
                { code: "XYZ", begruendung: "gibt es nicht" },
              ],
              hinweise: "",
            }),
          },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
});

let customerId: string;
const now = new Date("2026-11-17T09:00:00Z");

beforeAll(async () => {
  await new Promise<void>((resolve) => claude.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(claude.address() as AddressInfo).port}`;
  customerId = (await (await import("@/lib/workspace/customers")).createCustomer({ name: "Huber Steuerberatung" })).id;
});
afterAll(() => new Promise<void>((resolve) => claude.close(() => resolve())));

describe("Support-Ende", () => {
  it("erkennt abgelaufene und bald endende Versionen", () => {
    expect(eolStatus("Windows 10 Pro 22H2", "2026-11-17")).toMatchObject({ label: "Windows 10", state: "abgelaufen", server: false });
    expect(eolStatus("Microsoft Windows Server 2016 Standard", "2026-11-17")).toMatchObject({
      state: "bald",
      server: true,
      end: "2027-01-12",
    });
    expect(eolStatus("Windows Server 2019", "2026-11-17")!.state).toBe("ok");
    expect(eolStatus("Windows 11 Pro", "2026-11-17")).toBeNull();
    expect(eolStatus("Windows 10 IoT Enterprise", "2026-11-17")!.state).toBe("abgelaufen");
  });
});

describe("SLA in Geschäftszeiten (Wien)", () => {
  it("rechnet über Wochenenden und Feierabend", async () => {
    const sla = await import("@/lib/sla");
    // Freitag 13.11.2026, 16:00 Wien (15:00 UTC) + 2 Geschäftsstunden → Montag 9:00 Wien (8:00 UTC)
    expect(sla.addBusinessHours(new Date("2026-11-13T15:00:00Z"), 2).toISOString()).toBe("2026-11-16T08:00:00.000Z");
    // Fr 16–17 Uhr und Mo 8–10 Uhr = 3 Stunden; Samstag und Abend zählen nicht
    expect(sla.businessHoursBetween(new Date("2026-11-13T15:00:00Z"), new Date("2026-11-16T09:00:00Z"))).toBe(3);
    expect(sla.addBusinessHours(new Date("2026-11-14T19:00:00Z"), 1).toISOString()).toBe("2026-11-16T08:00:00.000Z");
  });

  it("bewertet Tickets je Paket und Priorität", async () => {
    const { ticketSla } = await import("@/lib/sla");
    // Pro, hoch: Reaktion 4 h, Lösung 16 h. Erstellt Montag 16.11. 9:00 Wien, jetzt Dienstag 10:00 (= 10 Geschäftsstunden später)
    const created = "2026-11-16T08:00:00.000Z";
    const late = ticketSla({ createdAt: created, firstResponseAt: null, resolvedAt: null, status: "Open", priority: "High" }, "pro", now);
    expect(late.response).toMatchObject({ targetH: 4, state: "verletzt" });
    expect(late.resolution).toMatchObject({ targetH: 16, state: "ok", leftH: 6 });
    const answered = ticketSla(
      { createdAt: created, firstResponseAt: "2026-11-16T09:00:00.000Z", resolvedAt: null, status: "Open", priority: "High" },
      "pro",
      now,
    );
    expect(answered.response).toMatchObject({ state: "erfüllt", tookH: 1 });
    expect(
      ticketSla({ createdAt: created, firstResponseAt: null, resolvedAt: null, status: "Open", priority: "Medium" }, "keins", now)
        .resolution.state,
    ).toBe("keine Zusage");
  });
});

describe("Angebote", () => {
  it("baut drei Pakete und rechnet im Code", async () => {
    const { buildItems, buildTiers, keywordSelection } = await import("@/lib/workspace/quotes");
    const { serviceMap, listServices } = await import("@/lib/workspace/catalog");
    const services = await serviceMap();
    const ctx = { employees: 12, devices: 10, servers: 1 };
    const items = buildItems([{ code: "MW" }, { code: "BCK" }, { code: "mw" }, { code: "NIX" }], services, ctx);
    expect(items.map((i) => [i.code, i.quantity, i.total])).toEqual([
      ["MW", 12, 468],
      ["BCK", 1, 89],
    ]);
    const tiers = buildTiers(items, services, ctx, ["SEC"]);
    expect(tiers.map((t) => t.key)).toEqual(["XL", "S", "M"]);
    expect(tiers[0].items.map((i) => i.code)).toEqual(["MW", "BCK", "AWR", "M365B"]); // SEC ist schon gebucht
    expect(tiers[1].items.map((i) => i.code)).toEqual(["MW"]);
    expect(tiers[2]).toMatchObject({ recommended: true, totalMonthly: 557, totalOnce: 0 });
    expect(keywordSelection("Backup und neue Firewall mit VPN", await listServices(), []).map((s) => s.code)).toEqual(
      expect.arrayContaining(["BCK", "MFW"]),
    );
  });

  it("erstellt mit Claude, verwirft unbekannte Codes und korrigiert Mengen; Annahme bucht die Leistungen", async () => {
    const catalog = await import("@/lib/workspace/catalog");
    await catalog.saveContractProfile(customerId, { industry: "Steuerberatung", employees: 12, package: "keins", contractEnd: null });
    const quotes = await import("@/lib/workspace/quotes");
    const { id, warning } = await quotes.createQuote({ customerId, need: "12 Arbeitsplätze, will Sicherheit", tiers: true }, "Max", now);
    expect(warning).toBeUndefined();
    const quote = (await quotes.getQuote(id))!;
    expect(quote).toMatchObject({ number: "AN-2026-001", title: "Sicher und planbar", provider: "claude", status: "entwurf" });
    const recommended = quote.tiers.find((t) => t.recommended)!;
    expect(recommended.items.map((i) => [i.code, i.quantity, i.total])).toEqual([
      ["MW", 12, 468],
      ["SEC", 12, 144],
    ]);
    expect(JSON.stringify(claudeBodies[0].messages)).toContain("12 Arbeitsplätze, will Sicherheit");

    await quotes.setQuoteStatus(id, "angenommen", "M", now);
    expect((await catalog.bookedServices(customerId)).map((b) => [b.code, b.quantity])).toEqual([
      ["MW", 12],
      ["SEC", 12],
    ]);
    expect((await catalog.mrrByCustomer()).get(customerId)).toBe(612);
    expect((await catalog.contractProfile(customerId)).package).toBe("basis");
    await expect(quotes.setQuoteStatus(id, "abgelehnt", null, now)).rejects.toThrow("bereits angenommen");
  });
});

describe("Umsatz-Radar mit Demo-Daten", () => {
  it("findet nachvollziehbare Chancen und lässt Gebuchtes weg", async () => {
    const demo = await import("@/lib/demo");
    await demo.seedDemo("Max", now);
    const { scanRadar } = await import("@/lib/radar");
    const radar = await scanRadar(undefined, now);
    const titles = radar.opportunities.map((o) => `${o.customer}: ${o.title}`);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Bäckerei Gruber (Demo): Windows 10-Migration (1 Gerät)",
        "Bäckerei Gruber (Demo): Auf Managed-Services-Vertrag umstellen",
        "Bäckerei Gruber (Demo): E-Mail-Absicherung (SPF/DKIM/DMARC)",
        "Autohaus Berger (Demo): Vertragsverlängerung + Paket-Upgrade",
        "Autohaus Berger (Demo): Windows 10-Migration (1 Gerät)",
      ]),
    );
    expect(titles).not.toContain("Huber Steuerberatung (Demo): Security-Paket (EDR/MDR)");
    const managed = radar.opportunities.find((o) => o.title === "Auf Managed-Services-Vertrag umstellen")!;
    expect(managed).toMatchObject({ monthly: 18 * 39, annual: 18 * 39 * 12, priority: 3 });
    expect(radar.totalAnnual).toBeGreaterThan(0);

    const { slaOverview } = await import("@/lib/sla");
    const sla = await slaOverview(30, now);
    expect(sla.measured).toBeGreaterThan(0);
    expect(sla.customers.map((c) => c.customer)).toEqual(expect.arrayContaining(["Huber Steuerberatung (Demo)", "Autohaus Berger (Demo)"]));
  });
});
