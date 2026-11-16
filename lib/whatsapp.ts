import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { secretsMatch } from "@/lib/secrets";

// WhatsApp Business Platform (Cloud API von Meta): Webhook-Prüfung, eingehende Nachrichten, Versand.

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v24.0";
const API_URL = process.env.WHATSAPP_API_URL || "https://graph.facebook.com";

export class WhatsAppError extends Error {}

export function whatsappConfigured(): boolean {
  const { WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN } = process.env;
  return Boolean(WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN && WHATSAPP_APP_SECRET && WHATSAPP_VERIFY_TOKEN);
}

/** Prüft die Signatur, mit der Meta jeden Webhook unterschreibt (HMAC-SHA256 über den Rohtext mit dem App-Geheimnis). */
export function validSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  return secretsMatch(header, expected);
}

/** Antwort auf die Abo-Bestätigung von Meta (GET mit hub.mode, hub.verify_token, hub.challenge). */
export function verificationChallenge(params: URLSearchParams): string | null {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!token || params.get("hub.mode") !== "subscribe") return null;
  return secretsMatch(params.get("hub.verify_token") ?? "", token) ? params.get("hub.challenge") : null;
}

const Webhook = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              field: z.string().optional(),
              value: z
                .object({
                  contacts: z
                    .array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() }))
                    .optional(),
                  messages: z
                    .array(
                      z.object({
                        from: z.string(),
                        id: z.string(),
                        timestamp: z.string().optional(),
                        type: z.string(),
                        text: z.object({ body: z.string() }).optional(),
                      }),
                    )
                    .optional(),
                })
                .passthrough(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

export type WhatsAppIncoming = {
  waId: string;
  name: string | null;
  messageId: string;
  /** Text der Nachricht; null bei Bildern, Sprachnachrichten usw. */
  text: string | null;
  type: string;
  receivedAt: Date;
};

/** Eingehende Nachrichten aus einem Webhook (Statusmeldungen wie „zugestellt“ werden ignoriert). */
export function parseWebhook(body: unknown): WhatsAppIncoming[] {
  const parsed = Webhook.safeParse(body);
  if (!parsed.success) return [];
  const incoming: WhatsAppIncoming[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const names = new Map((change.value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
      for (const message of change.value.messages ?? []) {
        incoming.push({
          waId: message.from,
          name: names.get(message.from) ?? null,
          messageId: message.id,
          text: message.type === "text" ? (message.text?.body ?? null) : null,
          type: message.type,
          receivedAt: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date(),
        });
      }
    }
  }
  return incoming;
}

async function call(body: Record<string, unknown>): Promise<Response> {
  try {
    return await fetch(`${API_URL}/${API_VERSION}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID!)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new WhatsAppError(`WhatsApp nicht erreichbar (${error instanceof Error ? error.message : String(error)})`);
  }
}

/** Sendet eine Textnachricht; liefert die Nachrichten-ID von WhatsApp. */
export async function sendWhatsAppText(waId: string, text: string): Promise<string | null> {
  const response = await call({ recipient_type: "individual", to: waId, type: "text", text: { preview_url: false, body: text } });
  const data = (await response.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!response.ok) {
    throw new WhatsAppError(
      `WhatsApp-Versand fehlgeschlagen (HTTP ${response.status}${data.error?.message ? `: ${data.error.message}` : ""})`,
    );
  }
  return data.messages?.[0]?.id ?? null;
}

/** Markiert eine eingegangene Nachricht als gelesen (blaue Haken beim Kunden). Fehler sind unkritisch. */
export async function markWhatsAppRead(messageId: string): Promise<void> {
  try {
    await call({ status: "read", message_id: messageId });
  } catch (error) {
    console.error("WhatsApp-Lesebestätigung fehlgeschlagen:", error);
  }
}
