import { after, NextResponse } from "next/server";
import { handleIncomingChat } from "@/lib/chat/handle";
import { normalizePhone } from "@/lib/leads";
import { dispatchEvents } from "@/lib/notify";
import { senderFor } from "@/lib/chat/senders";
import { markWhatsAppRead, parseWebhook, validSignature, verificationChallenge, whatsappConfigured } from "@/lib/whatsapp";

// Webhook der WhatsApp Cloud API. In der Meta-App als Callback-URL eintragen, Feld „messages“ abonnieren.

/** Abo-Bestätigung durch Meta. */
export async function GET(request: Request) {
  const challenge = verificationChallenge(new URL(request.url).searchParams);
  return challenge ? new Response(challenge, { status: 200 }) : new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  if (!whatsappConfigured()) return NextResponse.json({ error: "WhatsApp ist nicht konfiguriert" }, { status: 503 });
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Ungültige Signatur" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON" }, { status: 400 });
  }

  // Meta erwartet schnell eine 200-Antwort; die eigentliche Verarbeitung läuft danach.
  const messages = parseWebhook(body);
  if (messages.length > 0) {
    after(async () => {
      for (const message of messages) {
        await markWhatsAppRead(message.messageId);
        const { events } = await handleIncomingChat(
          {
            channel: "whatsapp",
            contact: message.waId,
            contactName: message.name,
            contactPhone: normalizePhone(`+${message.waId}`),
            text: message.text ?? `[${message.type}]`,
            externalId: message.messageId,
            receivedAt: message.receivedAt,
            unsupported: message.text === null,
          },
          senderFor("whatsapp"),
        );
        if (events.length > 0) await dispatchEvents(events);
      }
    });
  }
  return NextResponse.json({ received: messages.length });
}
