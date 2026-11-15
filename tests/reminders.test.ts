import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { zonedToUtc } from "@/lib/calendar";

// Nachgebauter SMS-Dienst (Twilio) und lokaler Mailserver
const sms: { to: string; body: string; auth: string }[] = [];
const twilio = { fail: false };
const smsServer: Server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const form = new URLSearchParams(body);
    if (twilio.fail) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ code: 21614, message: "'To' number is not a valid mobile number" }));
    }
    sms.push({ to: form.get("To")!, body: form.get("Body")!, auth: req.headers.authorization ?? "" });
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sid: "SM1", status: "queued" }));
  });
});
const mails: { to: string; raw: string }[] = [];
const smtp = new SMTPServer({
  disabledCommands: ["STARTTLS", "AUTH"],
  onData(stream, session, callback) {
    let raw = "";
    stream.on("data", (chunk) => (raw += chunk));
    stream.on("end", () => {
      mails.push({ to: session.envelope.rcptTo.map((r) => r.address).join(","), raw });
      callback();
    });
  },
});

let appointments: typeof import("@/lib/appointments");
let reminders: typeof import("@/lib/reminders");
let smsLib: typeof import("@/lib/sms");

beforeAll(async () => {
  await new Promise<void>((resolve) => smsServer.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => smtp.listen(2528, "127.0.0.1", resolve));
  Object.assign(process.env, {
    DATABASE_URL: `file:${path.join(mkdtempSync(path.join(tmpdir(), "erinnerung-")), "test.db")}`,
    TWILIO_API_URL: `http://127.0.0.1:${(smsServer.address() as AddressInfo).port}`,
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "token",
    TWILIO_FROM: "+4312345678",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "2528",
    SMTP_FROM: "Autowerkstatt Muster <office@autowerkstatt-muster.example>",
  });
  appointments = await import("@/lib/appointments");
  reminders = await import("@/lib/reminders");
  smsLib = await import("@/lib/sms");
});
afterAll(async () => {
  await new Promise<void>((resolve) => smsServer.close(() => resolve()));
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
});
beforeEach(() => {
  twilio.fail = false;
});

const at = (day: string, time: string) => zonedToUtc(day, time, "Europe/Vienna");

async function book(day: string, time: string, contact: { phone?: string; email?: string }, bookedAt: Date) {
  const result = await appointments.bookAppointment(
    { serviceId: "reifen", start: at(day, time), name: "Maria Huber", source: "telefon", ...contact },
    bookedAt,
  );
  if (!result.ok) throw new Error(`Buchung fehlgeschlagen: ${result.reason}`);
  return result.appointment;
}

describe("Mobilnummern", () => {
  it("erkennt österreichische und deutsche Mobilnummern", () => {
    expect(smsLib.isMobileNumber("+436641234567")).toBe(true);
    expect(smsLib.isMobileNumber("+4312345678")).toBe(false); // Wiener Festnetz
    expect(smsLib.isMobileNumber("+4915112345678")).toBe(true);
    expect(smsLib.isMobileNumber("+493012345678")).toBe(false);
  });
});

describe("Bestätigung", () => {
  const bookedAt = at("2026-11-16", "07:00");

  it("geht per SMS an Mobilnummern – mit Datum, Adresse und Telefonnummer", async () => {
    const appointment = await book("2026-11-17", "10:00", { phone: "0664 1234567" }, bookedAt);
    await reminders.confirmAppointment(appointment.id);
    expect(sms.at(-1)).toMatchObject({ to: "+436641234567", auth: `Basic ${Buffer.from("AC123:token").toString("base64")}` });
    expect(sms.at(-1)!.body).toBe(
      "Autowerkstatt Muster: Ihr Termin (Reifenwechsel) am Di., 17.11., 10:00 Uhr ist bestätigt. Musterstraße 12, 1210 Wien. Änderungen bitte unter +43 1 234 56 78.",
    );
    expect(await appointments.getAppointment(appointment.id)).toMatchObject({ confirmationChannel: "sms", notifyError: null });
  });

  it("nimmt bei Festnetznummer die E-Mail", async () => {
    const appointment = await book("2026-11-17", "10:30", { phone: "01 2345678", email: "maria@example.com" }, bookedAt);
    const smsBefore = sms.length;
    await reminders.confirmAppointment(appointment.id);
    expect(sms).toHaveLength(smsBefore);
    expect(mails.at(-1)!.to).toBe("maria@example.com");
    expect(mails.at(-1)!.raw).toMatch(/Terminbest=C3=A4tigung|Terminbestätigung/);
  });

  it("weicht bei SMS-Fehler auf E-Mail aus und vermerkt den Fehler", async () => {
    twilio.fail = true;
    const appointment = await book("2026-11-17", "11:00", { phone: "0664 7654321", email: "maria@example.com" }, bookedAt);
    await reminders.confirmAppointment(appointment.id);
    const stored = await appointments.getAppointment(appointment.id);
    expect(stored).toMatchObject({ confirmationChannel: "email" });
    expect(stored!.notifyError).toContain("21614");
  });

  it("vermerkt nicht zustellbare Bestätigungen und sendet nie doppelt", async () => {
    const appointment = await book("2026-11-17", "11:30", {}, bookedAt);
    await reminders.confirmAppointment(appointment.id);
    expect(await appointments.getAppointment(appointment.id)).toMatchObject({ confirmationChannel: null });
    const counts = [sms.length, mails.length];
    await reminders.confirmAppointment(appointment.id);
    expect([sms.length, mails.length]).toEqual(counts);
  });
});

describe("Erinnerungen", () => {
  it("erinnert rund 24 Stunden vorher, nur einmal und nicht bei kurzfristigen Buchungen", async () => {
    const early = await book("2026-11-19", "09:00", { phone: "0676 1111111" }, at("2026-11-16", "08:00"));
    // Am selben Tag um 8:00 für 16:00 gebucht – die Bestätigung reicht
    const lastMinute = await book("2026-11-18", "16:00", { phone: "0676 2222222" }, at("2026-11-18", "08:00"));
    const later = await book("2026-11-20", "09:00", { phone: "0676 3333333" }, at("2026-11-16", "08:00"));
    // Am Vortag um 7:00 für 19.11. 10:00 gebucht (27 h vorher, also vor dem Erinnerungsfenster) – wird erinnert
    const dayBefore = await book("2026-11-19", "10:00", { phone: "0676 5555555" }, at("2026-11-18", "07:00"));
    // Am Vortag um 9:00 für 19.11. 8:00 gebucht (23 h vorher) – Bestätigung genügt
    const insideWindow = await book("2026-11-19", "08:00", { phone: "0676 6666666" }, at("2026-11-18", "09:00"));

    const now = at("2026-11-18", "10:00");
    expect(await reminders.sendDueReminders(now)).toEqual({ quiet: false, sent: 2, undeliverable: 0 });
    expect(sms.slice(-2).map((m) => m.to)).toEqual(["+436761111111", "+436765555555"]);
    expect((await appointments.getAppointment(dayBefore.id))!.reminderChannel).toBe("sms");
    expect((await appointments.getAppointment(insideWindow.id))!.reminderSentAt).toBeNull();
    expect(sms.at(-2)!.body).toContain("Erinnerung von Autowerkstatt Muster: Reifenwechsel am Do., 19.11., 9:00 Uhr");
    expect((await appointments.getAppointment(early.id))!.reminderChannel).toBe("sms");
    expect((await appointments.getAppointment(lastMinute.id))!.reminderSentAt).toBeNull();
    expect((await appointments.getAppointment(later.id))!.reminderSentAt).toBeNull();

    // Zweiter Lauf: nichts mehr fällig
    expect(await reminders.sendDueReminders(now)).toEqual({ quiet: false, sent: 0, undeliverable: 0 });
  });

  it("schickt nachts nichts", async () => {
    await book("2026-11-20", "08:00", { phone: "0676 4444444" }, at("2026-11-16", "08:00"));
    const smsBefore = sms.length;
    expect(await reminders.sendDueReminders(at("2026-11-19", "22:30"))).toEqual({ quiet: true, sent: 0, undeliverable: 0 });
    expect(sms).toHaveLength(smsBefore);
  });
});
