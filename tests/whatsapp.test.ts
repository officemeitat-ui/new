import { createHmac } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Nachgebaute Graph-API von Meta
const calls: { url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
const graph: Server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    calls.push({ url: req.url!, headers: req.headers, body });
    res.writeHead(body.to === "4300000000" ? 400 : 200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        body.to === "4300000000"
          ? { error: { message: "Recipient phone number not in allowed list", code: 131030 } }
          : { messaging_product: "whatsapp", messages: [{ id: "wamid.gesendet" }] },
      ),
    );
  });
});

let wa: typeof import("@/lib/whatsapp");
beforeAll(async () => {
  await new Promise<void>((resolve) => graph.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, {
    WHATSAPP_API_URL: `http://127.0.0.1:${(graph.address() as AddressInfo).port}`,
    WHATSAPP_PHONE_NUMBER_ID: "1234567890",
    WHATSAPP_ACCESS_TOKEN: "EAAG-token",
    WHATSAPP_APP_SECRET: "app-geheimnis",
    WHATSAPP_VERIFY_TOKEN: "mein-verify-token",
  });
  wa = await import("@/lib/whatsapp");
});
afterAll(() => new Promise<void>((resolve) => graph.close(() => resolve())));

const sign = (body: string, secret = "app-geheimnis") => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("Webhook-Sicherheit", () => {
  it("akzeptiert nur korrekt signierte Webhooks", () => {
    const body = '{"entry":[]}';
    expect(wa.validSignature(body, sign(body))).toBe(true);
    expect(wa.validSignature(body, sign(body, "falsch"))).toBe(false);
    expect(wa.validSignature(`${body} `, sign(body))).toBe(false);
    expect(wa.validSignature(body, null)).toBe(false);
  });

  it("bestätigt das Abo nur mit dem richtigen Verify-Token", () => {
    const params = (token: string) =>
      new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "1158201444" });
    expect(wa.verificationChallenge(params("mein-verify-token"))).toBe("1158201444");
    expect(wa.verificationChallenge(params("falsch"))).toBeNull();
  });
});

describe("parseWebhook", () => {
  it("liest Text- und andere Nachrichten samt Namen und ignoriert Statusmeldungen", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "4312345678", phone_number_id: "1234567890" },
                contacts: [{ profile: { name: "Peter Berger" }, wa_id: "436641112233" }],
                messages: [
                  { from: "436641112233", id: "wamid.A", timestamp: "1794812400", type: "text", text: { body: "Grüß Gott!" } },
                  { from: "436641112233", id: "wamid.B", timestamp: "1794812460", type: "image", image: { id: "img" } },
                ],
              },
            },
            { field: "messages", value: { statuses: [{ id: "wamid.X", status: "delivered" }] } },
          ],
        },
      ],
    };
    expect(wa.parseWebhook(payload)).toEqual([
      {
        waId: "436641112233",
        name: "Peter Berger",
        messageId: "wamid.A",
        text: "Grüß Gott!",
        type: "text",
        receivedAt: new Date(1794812400 * 1000),
      },
      {
        waId: "436641112233",
        name: "Peter Berger",
        messageId: "wamid.B",
        text: null,
        type: "image",
        receivedAt: new Date(1794812460 * 1000),
      },
    ]);
    expect(wa.parseWebhook({ unerwartet: true })).toEqual([]);
  });
});

describe("Versand", () => {
  it("schickt Textnachrichten an die Cloud API und liefert die Nachrichten-ID", async () => {
    expect(await wa.sendWhatsAppText("436641112233", "Hallo!")).toBe("wamid.gesendet");
    const call = calls.at(-1)!;
    expect(call.url).toBe("/v24.0/1234567890/messages");
    expect(call.headers.authorization).toBe("Bearer EAAG-token");
    expect(call.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "436641112233",
      type: "text",
      text: { preview_url: false, body: "Hallo!" },
    });
  });

  it("meldet Fehler der Cloud API verständlich", async () => {
    await expect(wa.sendWhatsAppText("4300000000", "Hallo")).rejects.toThrow("Recipient phone number not in allowed list");
  });

  it("markiert Nachrichten als gelesen", async () => {
    await wa.markWhatsAppRead("wamid.A");
    expect(calls.at(-1)!.body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.A" });
  });
});
