import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { zonedToUtc } from "@/lib/calendar";

// Nachgebaute Google- und Microsoft-Kalender-API mit In-Memory-Terminen.
type StoredEvent = { id: string; start: string; end: string; body: Record<string, unknown> };
const mock = {
  google: [] as StoredEvent[],
  microsoft: [] as StoredEvent[],
  failList: false,
  failInsert: false,
  dropConnections: false,
  jwtErrors: [] as string[],
  lastGraphCreate: null as Record<string, unknown> | null,
  counter: 0,
};

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = {
  client_email: "cockpit@projekt.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

let baseUrl = "";
const server: Server = createServer(async (req, res) => {
  if (mock.dropConnections) return req.socket.destroy();
  const url = new URL(req.url!, baseUrl);
  const body = await readBody(req);
  const json = (status: number, data?: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(data === undefined ? "" : JSON.stringify(data));
  };

  // Google: Token-Austausch mit Prüfung des signierten JWT
  if (url.pathname === "/google/token") {
    const form = new URLSearchParams(body);
    const [header, claims, signature] = (form.get("assertion") ?? "").split(".");
    const valid = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature ?? "", "base64url"));
    const payload = JSON.parse(Buffer.from(claims ?? "", "base64url").toString() || "{}");
    if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") mock.jwtErrors.push("grant_type");
    if (!valid) mock.jwtErrors.push("signatur");
    if (payload.iss !== account.client_email || payload.aud !== `${baseUrl}/google/token`) mock.jwtErrors.push("claims");
    return json(valid ? 200 : 401, { access_token: "g-token", expires_in: 3600 });
  }
  if (url.pathname.startsWith("/google/calendar/")) {
    if (req.headers.authorization !== "Bearer g-token") return json(401, {});
    const match = url.pathname.match(/\/events(?:\/(.+))?$/);
    if (req.method === "GET") {
      if (mock.failList) return json(503, { error: "unavailable" });
      // Zwei Seiten, um die Blätterlogik zu prüfen
      const page = url.searchParams.get("pageToken") === "2" ? 1 : 0;
      const items = mock.google.map((e) => ({ id: e.id, ...e.body }));
      const half = Math.ceil(items.length / 2);
      return json(200, page === 0 ? { items: items.slice(0, half), nextPageToken: "2" } : { items: items.slice(half) });
    }
    if (req.method === "POST") {
      if (mock.failInsert) return json(500, { error: "kaputt" });
      const event = JSON.parse(body);
      const id = `g-${++mock.counter}`;
      mock.google.push({ id, start: event.start.dateTime, end: event.end.dateTime, body: event });
      return json(200, { id });
    }
    if (req.method === "DELETE") {
      const before = mock.google.length;
      mock.google = mock.google.filter((e) => e.id !== decodeURIComponent(match![1]));
      return json(before === mock.google.length ? 410 : 204);
    }
  }

  // Microsoft: Client Credentials und Graph
  if (url.pathname === "/ms/tenant-1/oauth2/v2.0/token") {
    const form = new URLSearchParams(body);
    const ok = form.get("grant_type") === "client_credentials" && form.get("client_secret") === "geheim";
    return json(ok ? 200 : 401, { access_token: "m-token", expires_in: 3600 });
  }
  if (url.pathname.startsWith("/graph/users/werkstatt%40example.at/")) {
    if (req.headers.authorization !== "Bearer m-token") return json(401, {});
    if (req.method === "GET") {
      if (mock.failList) return json(503, {});
      return json(200, {
        value: mock.microsoft.map((e) => ({
          id: e.id,
          start: { dateTime: e.start, timeZone: "UTC" },
          end: { dateTime: e.end, timeZone: "UTC" },
          ...e.body,
        })),
      });
    }
    if (req.method === "POST") {
      const event = JSON.parse(body);
      mock.lastGraphCreate = event;
      const id = `m-${++mock.counter}`;
      mock.microsoft.push({ id, start: `${event.start.dateTime}.0000000`, end: `${event.end.dateTime}.0000000`, body: { showAs: "busy" } });
      return json(201, { id });
    }
    if (req.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.split("/").pop()!);
      mock.microsoft = mock.microsoft.filter((e) => e.id !== id);
      return json(204);
    }
  }
  json(404, { path: url.pathname });
});

let appointments: typeof import("@/lib/appointments");
let sync: typeof import("@/lib/calendar-sync");

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "kalender-")), "test.db")}`;
  process.env.GOOGLE_TOKEN_URL = `${baseUrl}/google/token`;
  process.env.GOOGLE_CALENDAR_API_URL = `${baseUrl}/google/calendar`;
  process.env.GOOGLE_CALENDAR_ID = "werkstatt@group.calendar.google.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(account);
  process.env.MS_LOGIN_URL = `${baseUrl}/ms`;
  process.env.MS_GRAPH_URL = `${baseUrl}/graph`;
  Object.assign(process.env, {
    MS_TENANT_ID: "tenant-1",
    MS_CLIENT_ID: "app",
    MS_CLIENT_SECRET: "geheim",
    MS_CALENDAR_USER: "werkstatt@example.at",
  });
  appointments = await import("@/lib/appointments");
  sync = await import("@/lib/calendar-sync");
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  mock.failList = false;
  mock.failInsert = false;
  mock.dropConnections = false;
  sync.invalidateExternalBusy();
});

// Montag, 16.11.2026; Vorführbetrieb: Kapazität 2, externe Einträge blockieren alles
const now = zonedToUtc("2026-11-16", "06:00", "Europe/Vienna");
const at = (day: string, time: string) => zonedToUtc(day, time, "Europe/Vienna");
const iso = (day: string, time: string) => at(day, time).toISOString();
const freeAt = async (day: string, time: string) => {
  const busy = await appointments.busyBetween(at(day, "00:00"), at(day, "23:59"));
  return busy.filter((b) => b.start < at(day, time) && b.end > at(day, time)).length;
};

describe("Google Kalender", () => {
  beforeAll(() => {
    process.env.CALENDAR_PROVIDER = "google";
    mock.google = [
      {
        id: "zahnarzt",
        start: iso("2026-11-16", "09:00"),
        end: iso("2026-11-16", "10:00"),
        body: { start: { dateTime: iso("2026-11-16", "09:00") }, end: { dateTime: iso("2026-11-16", "10:00") } },
      },
      { id: "urlaub", start: "", end: "", body: { start: { date: "2026-11-18" }, end: { date: "2026-11-19" } } },
      {
        id: "frei",
        start: "",
        end: "",
        body: {
          transparency: "transparent",
          start: { dateTime: iso("2026-11-16", "13:00") },
          end: { dateTime: iso("2026-11-16", "14:00") },
        },
      },
      {
        id: "abgesagt",
        start: "",
        end: "",
        body: { status: "cancelled", start: { dateTime: iso("2026-11-16", "14:00") }, end: { dateTime: iso("2026-11-16", "15:00") } },
      },
    ];
  });

  it("meldet sich mit korrekt signiertem Dienstkonto-JWT an", async () => {
    await appointments.busyBetween(now, at("2026-11-17", "00:00"));
    expect(mock.jwtErrors).toEqual([]);
  });

  it("zählt externe Termine (auch ganztägige) als belegt, freie und abgesagte nicht", async () => {
    expect(await freeAt("2026-11-16", "09:30")).toBe(2); // blockiert beide Plätze
    expect(await freeAt("2026-11-18", "10:00")).toBe(2); // Urlaub ganztägig
    expect(await freeAt("2026-11-16", "13:30")).toBe(0);
    expect(await freeAt("2026-11-16", "14:30")).toBe(0);
    const blocked = await appointments.bookAppointment(
      { serviceId: "pickerl", start: at("2026-11-16", "09:00"), name: "X", source: "manuell" },
      now,
    );
    expect(blocked).toEqual({ ok: false, reason: "nicht_verfuegbar" });
  });

  it("trägt Buchungen ein, zählt sie aber nur einmal und löscht sie beim Storno", async () => {
    const booked = await appointments.bookAppointment(
      { serviceId: "pickerl", start: at("2026-11-16", "11:00"), name: "Maria Huber", phone: "0664 1112233", source: "telefon" },
      now,
    );
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;
    expect(booked.appointment.externalId).toMatch(/^g-/);
    const created = mock.google.find((e) => e.id === booked.appointment.externalId)!;
    expect(created.body).toMatchObject({
      summary: "§57a-Überprüfung (Pickerl) – Maria Huber",
      extendedProperties: { private: { kiCockpitAppointment: booked.appointment.id } },
    });
    // Ein Platz ist noch frei – der eigene Eintrag im Google Kalender zählt nicht doppelt
    expect(await freeAt("2026-11-16", "11:30")).toBe(1);

    const cancelled = await appointments.cancelAppointment(booked.appointment.id);
    expect(cancelled).toMatchObject({ status: "storniert", externalId: null, syncError: null });
    expect(mock.google.some((e) => e.id === booked.appointment.externalId)).toBe(false);
  });

  it("bucht nicht, wenn der Kalender nicht erreichbar ist", async () => {
    mock.failList = true;
    const result = await appointments.bookAppointment(
      { serviceId: "reifen", start: at("2026-11-17", "08:00"), name: "Y", source: "manuell" },
      now,
    );
    expect(result).toEqual({ ok: false, reason: "kalender_nicht_erreichbar" });
    await expect(appointments.busyBetween(at("2026-11-17", "00:00"), at("2026-11-18", "00:00"))).rejects.toBeInstanceOf(
      sync.CalendarSyncError,
    );
    const list = await appointments.listAppointments(at("2026-11-17", "00:00"), at("2026-11-18", "00:00"));
    expect(list).toHaveLength(0);
  });

  it("meldet Netzwerkfehler als Kalenderfehler und bucht dann nicht", async () => {
    mock.dropConnections = true;
    const result = await appointments.bookAppointment(
      { serviceId: "reifen", start: at("2026-11-17", "09:00"), name: "N", source: "manuell" },
      now,
    );
    expect(result).toEqual({ ok: false, reason: "kalender_nicht_erreichbar" });
    await expect(appointments.busyBetween(at("2026-11-17", "00:00"), at("2026-11-18", "00:00"))).rejects.toBeInstanceOf(
      sync.CalendarSyncError,
    );
  });

  it("merkt sich Übertragungsfehler und kann sie nachholen", async () => {
    mock.failInsert = true;
    const booked = await appointments.bookAppointment(
      { serviceId: "reifen", start: at("2026-11-17", "08:00"), name: "Z", source: "manuell" },
      now,
    );
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;
    expect(booked.appointment.externalId).toBeNull();
    expect(booked.appointment.syncError).toContain("HTTP 500");

    mock.failInsert = false;
    const retried = await appointments.pushToCalendar(booked.appointment);
    expect(retried.externalId).toMatch(/^g-/);
    expect(retried.syncError).toBeNull();
  });
});

describe("Microsoft 365", () => {
  beforeAll(() => {
    process.env.CALENDAR_PROVIDER = "microsoft";
    mock.microsoft = [
      { id: "meeting", start: "2026-11-19T08:00:00.0000000", end: "2026-11-19T09:00:00.0000000", body: { showAs: "busy" } },
      { id: "frei", start: "2026-11-19T12:00:00.0000000", end: "2026-11-19T13:00:00.0000000", body: { showAs: "free" } },
    ];
  });

  it("liest Graph-Zeiten (UTC, 7 Nachkommastellen) und ignoriert „frei“", async () => {
    expect(await freeAt("2026-11-19", "09:30")).toBe(2); // 08:00–09:00 UTC = 09:00–10:00 Wien
    expect(await freeAt("2026-11-19", "13:30")).toBe(0);
  });

  it("trägt Buchungen mit Transaktions-ID ein und löscht sie beim Storno", async () => {
    const booked = await appointments.bookAppointment(
      { serviceId: "diagnose", start: at("2026-11-19", "11:00"), name: "Karl Steiner", source: "email" },
      now,
    );
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;
    expect(booked.appointment.externalId).toMatch(/^m-/);
    expect(mock.lastGraphCreate).toMatchObject({
      subject: "Fehlerdiagnose – Karl Steiner",
      start: { dateTime: "2026-11-19T10:00:00", timeZone: "UTC" },
      transactionId: booked.appointment.id,
    });
    expect(await freeAt("2026-11-19", "11:30")).toBe(1);
    await appointments.cancelAppointment(booked.appointment.id);
    expect(mock.microsoft.some((e) => e.id === booked.appointment.externalId)).toBe(false);
  });

  it("meldet unvollständige Einrichtung als Kalenderfehler", () => {
    process.env.CALENDAR_PROVIDER = "outlook";
    expect(() => sync.calendarProvider()).toThrow(sync.CalendarSyncError);
    process.env.CALENDAR_PROVIDER = "microsoft";
  });
});
