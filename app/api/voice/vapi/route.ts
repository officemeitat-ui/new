import { after, NextResponse } from "next/server";
import { ZodError } from "zod";
import { secretsMatch } from "@/lib/secrets";
import { handleVapiMessage } from "@/lib/voice/handler";
import { dispatchEvents } from "@/lib/notify";

// Empfängt alle Server-Nachrichten von Vapi: Assistent-Anfrage zu Gesprächsbeginn,
// Werkzeugaufrufe während des Gesprächs und den Bericht nach Gesprächsende.
export async function POST(request: Request) {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Telefon-Assistent nicht konfiguriert (VAPI_WEBHOOK_SECRET fehlt)" }, { status: 503 });
  }
  if (!secretsMatch(request.headers.get("x-webhook-secret") ?? "", secret)) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.message) return NextResponse.json({ error: "Nachricht fehlt" }, { status: 400 });

  const serverUrl = `${process.env.PUBLIC_URL || new URL(request.url).origin}/api/voice/vapi`;
  try {
    const { response, events } = await handleVapiMessage(body.message, { serverUrl, secret });
    if (events.length > 0) after(() => dispatchEvents(events));
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Unerwartetes Nachrichtenformat" }, { status: 400 });
    console.error("Vapi-Nachricht fehlgeschlagen:", error);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
