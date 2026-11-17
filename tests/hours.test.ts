import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { formatHours, parseDuration } from "@/lib/workspace/format";

process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "hours-")), "test.db")}`;

let hours: typeof import("@/lib/workspace/hours");
let customers: typeof import("@/lib/workspace/customers");
let config: typeof import("@/config/workspace");
let huber: string;
let gruber: string;

beforeAll(async () => {
  hours = await import("@/lib/workspace/hours");
  customers = await import("@/lib/workspace/customers");
  config = await import("@/config/workspace");
  huber = (await customers.createCustomer({ name: "Huber Steuerberatung" })).id;
  gruber = (await customers.createCustomer({ name: "Bäckerei Gruber" })).id;
});

describe("Dauer eingeben und anzeigen", () => {
  it("versteht die üblichen Schreibweisen", () => {
    expect(parseDuration("1,5")).toBe(90);
    expect(parseDuration("1.25")).toBe(75);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("45 min")).toBe(45);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("2 h")).toBe(120);
    expect(parseDuration("2 Stunden")).toBe(120);
    expect(parseDuration("1 h 15")).toBe(75);
    expect(parseDuration("1h 15min")).toBe(75);
    expect(parseDuration("10")).toBe(600);
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("eine Stunde")).toBeNull();
    expect(parseDuration("1:75")).toBeNull();
  });

  it("zeigt Stunden mit Dezimalkomma und Vorzeichen", () => {
    expect(formatHours(90)).toBe("1,5 h");
    expect(formatHours(600)).toBe("10 h");
    expect(formatHours(50)).toBe("0,83 h");
    expect(formatHours(-30)).toBe("−0,5 h");
  });

  it("rundet nur, wenn ein Takt eingestellt ist", () => {
    expect(hours.roundMinutes(50, 0)).toBe(50);
    expect(hours.roundMinutes(50, 15)).toBe(60);
    expect(hours.roundMinutes(60, 15)).toBe(60);
    expect(hours.roundMinutes(1, 15)).toBe(15);
  });
});

describe("Stundenkonto", () => {
  it("zieht nur Buchungen „vom Stundenpaket“ vom Guthaben ab", async () => {
    await hours.addPackage({ customerId: huber, minutes: 600, date: "2026-10-01", priceCents: 95000, reference: "RE 2026-118" });
    await hours.addTimeEntry({ customerId: huber, date: "2026-10-15", minutes: 120, description: "Server-Update", mode: "kontingent" });
    await hours.addTimeEntry({
      customerId: huber,
      date: "2026-11-03",
      minutes: 90,
      description: "Outlook-Profile",
      mode: "kontingent",
      ticketId: "101",
    });
    await hours.addTimeEntry({
      customerId: huber,
      date: "2026-11-04",
      minutes: 240,
      description: "Neuer Server (Projekt)",
      mode: "verrechnen",
    });
    await hours.addTimeEntry({ customerId: huber, date: "2026-11-05", minutes: 15, description: "Kurze Rückfrage", mode: "intern" });

    const account = (await hours.getAccount(huber, "2026-11"))!;
    expect(account).toMatchObject({
      purchased: 600,
      used: 210,
      balance: 390,
      billableThisMonth: 240,
      lastEntry: "2026-11-05",
      status: "ok",
    });
    expect(await hours.monthSummary("2026-11")).toEqual({ kontingent: 90, verrechnen: 240, intern: 15 });
  });

  it("markiert knappe und überzogene Konten und sortiert sie nach oben", async () => {
    await hours.addPackage({ customerId: gruber, minutes: 300, date: "2026-11-01" });
    await hours.addTimeEntry({ customerId: gruber, date: "2026-11-10", minutes: 200, description: "Kassen", mode: "kontingent" });
    let accounts = await hours.listAccounts("2026-11");
    expect(accounts.map((a) => [a.customerName, a.status, a.balance])).toEqual([
      ["Bäckerei Gruber", "knapp", 100],
      ["Huber Steuerberatung", "ok", 390],
    ]);

    await hours.addTimeEntry({ customerId: gruber, date: "2026-11-12", minutes: 160, description: "Kassen Teil 2", mode: "kontingent" });
    accounts = await hours.listAccounts("2026-11");
    expect(accounts[0]).toMatchObject({ customerName: "Bäckerei Gruber", status: "ueberzogen", balance: -60 });
  });

  it("rundet Buchungen nach Einstellung auf und lässt Löschen zu", async () => {
    config.workspace.hours.roundToMinutes = 15;
    try {
      const entry = await hours.addTimeEntry({
        customerId: huber,
        date: "2026-11-20",
        minutes: 50,
        description: "Drucker",
        mode: "kontingent",
      });
      expect(entry.minutes).toBe(60);
      expect((await hours.getAccount(huber, "2026-11"))!.balance).toBe(330);
      await hours.deleteTimeEntry(entry.id);
      expect((await hours.getAccount(huber, "2026-11"))!.balance).toBe(390);
    } finally {
      config.workspace.hours.roundToMinutes = 0;
    }
  });

  it("lehnt ungültige Dauern ab", async () => {
    await expect(
      hours.addTimeEntry({ customerId: huber, date: "2026-11-20", minutes: 0, description: "x", mode: "intern" }),
    ).rejects.toThrow("Ungültige Dauer");
    await expect(hours.addPackage({ customerId: huber, minutes: -60, date: "2026-11-20" })).rejects.toThrow("Ungültige Stundenanzahl");
  });

  it("erstellt den Leistungsnachweis eines Monats mit Summen und Reststand", async () => {
    const csv = await hours.entriesCsv(huber, "2026-11");
    const lines = csv
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n");
    expect(lines[0]).toBe("Datum;Stunden;Tätigkeit;Ticket;Art");
    expect(lines.slice(1, 4)).toEqual([
      "2026-11-03;1,50;Outlook-Profile;#101;vom Stundenpaket",
      "2026-11-04;4,00;Neuer Server (Projekt);;separat verrechnen",
      "2026-11-05;0,25;Kurze Rückfrage;;nicht verrechnet",
    ]);
    expect(lines).toContain(";1,50;Summe vom Stundenpaket;;");
    expect(lines).toContain(";4,00;Summe separat verrechnen;;");
    expect(lines.at(-1)).toBe(";6,50;Reststand Stundenpaket (aktuell);;");
  });
});
