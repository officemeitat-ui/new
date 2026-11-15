import "server-only";

// SMS über Twilio (dieselbe Telefonie, die auch Vapi nutzen kann). Nur für organisatorische Nachrichten wie
// Terminbestätigungen und -erinnerungen – Werbe-SMS bräuchten eine vorherige Einwilligung (§ 174 TKG).

const API_URL = process.env.TWILIO_API_URL || "https://api.twilio.com";

export class SmsError extends Error {}

export function smsConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

/**
 * Grobe Prüfung auf Mobilnummer (Festnetz kann keine SMS empfangen).
 * Österreich: +43 65x–69x, Deutschland: +49 15x–17x; andere Länder werden zugelassen.
 */
export function isMobileNumber(e164: string): boolean {
  if (e164.startsWith("+43")) return /^\+436[5-9]\d{6,}$/.test(e164);
  if (e164.startsWith("+49")) return /^\+491[5-7]\d{7,}$/.test(e164);
  return /^\+\d{8,15}$/.test(e164);
}

export async function sendSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  let response: Response;
  try {
    response = await fetch(`${API_URL}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new SmsError(`SMS-Dienst nicht erreichbar (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string; code?: number };
    throw new SmsError(
      `SMS fehlgeschlagen (HTTP ${response.status}${data.code ? `, Code ${data.code}` : ""}${data.message ? `: ${data.message}` : ""})`,
    );
  }
}
