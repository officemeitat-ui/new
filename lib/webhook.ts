import "server-only";
import { createHmac } from "node:crypto";

export type WebhookEvent =
  | { event: "lead.created"; lead: Record<string, unknown> }
  | { event: "lead.stage_changed"; leadId: string; from: string; to: string };

/**
 * Sendet ein Ereignis an WEBHOOK_URL (z. B. n8n, Make, Zapier oder ein CRM).
 * Fehler werden nur protokolliert – ein nicht erreichbares CRM darf keine Anfrage verlieren lassen,
 * die Daten liegen ohnehin in der eigenen Datenbank.
 */
export async function sendWebhook(payload: WebhookEvent): Promise<void> {
  const url = process.env.WEBHOOK_URL;
  if (!url) return;

  const body = JSON.stringify({ ...payload, sentAt: new Date().toISOString() });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.WEBHOOK_SECRET) {
    headers["X-Signature"] = `sha256=${createHmac("sha256", process.env.WEBHOOK_SECRET).update(body).digest("hex")}`;
  }

  try {
    const response = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
    if (!response.ok) console.error(`Webhook ${payload.event} fehlgeschlagen: HTTP ${response.status}`);
  } catch (error) {
    console.error(`Webhook ${payload.event} fehlgeschlagen:`, error);
  }
}
