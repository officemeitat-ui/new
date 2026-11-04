import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import nodemailer, { type Transporter } from "nodemailer";

const log = createLogger("mail");
let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  const env = getEnv();
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } : undefined,
    // Defaults are 2 and 10 minutes; a blocked mail server must not hold a request that long.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return transporter;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function layout(title: string, body: string, cta: { label: string; url: string }): string {
  const { BRAND_PRIMARY_COLOR: color, BRAND_PRODUCT_NAME: product } = getEnv();
  return `<!doctype html><html lang="de"><body style="margin:0;background:#f4f5f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0b1220">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;padding:32px">
<tr><td><p style="margin:0 0 24px;font-weight:600">${escapeHtml(product)}</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
<p style="line-height:1.6;margin:0 0 24px">${body}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(cta.label)}</a></p>
<p style="font-size:13px;color:#5b6474;line-height:1.5;margin:0">Falls der Knopf nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:<br>${escapeHtml(cta.url)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

async function send(to: string, subject: string, text: string, html: string): Promise<void> {
  await getTransporter().sendMail({ from: getEnv().SMTP_FROM, to, subject, text, html });
  log.info({ subject }, "mail sent");
}

export async function sendInvitationEmail(input: {
  to: string;
  tenantName: string;
  inviterName: string | null;
  url: string;
}): Promise<void> {
  const who = input.inviterName ? `${input.inviterName} lädt Sie` : "Sie wurden";
  const verb = input.inviterName ? "ein" : "eingeladen";
  const sentence = `${who} zu „${input.tenantName}“ ${verb}. Die Einladung ist 7 Tage gültig.`;
  await send(
    input.to,
    `Einladung zu ${input.tenantName}`,
    `${sentence}\n\nEinladung annehmen: ${input.url}`,
    layout("Sie sind eingeladen", escapeHtml(sentence), {
      label: "Einladung annehmen",
      url: input.url,
    }),
  );
}

export async function sendMagicLinkEmail(to: string, url: string): Promise<void> {
  const sentence = "Mit diesem Link melden Sie sich ohne Passwort an. Er ist 10 Minuten gültig.";
  await send(
    to,
    "Ihr Anmeldelink",
    `${sentence}\n\n${url}`,
    layout("Anmelden", escapeHtml(sentence), { label: "Jetzt anmelden", url }),
  );
}

/**
 * Sent instead of a magic link when the account uses two-factor authentication: a link alone
 * would bypass the second factor (security review, finding 3).
 */
export async function sendTwoFactorLoginHintEmail(to: string, loginUrl: string): Promise<void> {
  const sentence =
    "Für Ihr Konto ist die Zwei-Faktor-Anmeldung aktiv. Bitte melden Sie sich mit Passwort und Code aus Ihrer Authenticator-App an – ein Anmeldelink ist dafür nicht möglich.";
  await send(
    to,
    "Anmeldung mit Passwort und Code",
    `${sentence}\n\n${loginUrl}`,
    layout("Anmelden", escapeHtml(sentence), { label: "Zur Anmeldung", url: loginUrl }),
  );
}

/** New defect report for the facility's manager (QR report, no AI involved). */
export async function sendDefectReportEmail(input: {
  to: string;
  facilityName: string;
  category: string;
  location: string | null;
  description: string;
  url: string;
}): Promise<void> {
  const where = input.location ? ` (${input.location})` : "";
  const sentence = `Neue Meldung für ${input.facilityName}${where}: ${input.category}.`;
  await send(
    input.to,
    `Neue Meldung: ${input.facilityName}`,
    `${sentence}\n\n${input.description}\n\n${input.url}`,
    layout("Neue Meldung", `${escapeHtml(sentence)}<br><br>${escapeHtml(input.description)}`, {
      label: "Meldung ansehen",
      url: input.url,
    }),
  );
}

/** Tells the person who reported a defect that it has been taken care of. */
export async function sendDefectResolvedEmail(input: {
  to: string;
  facilityName: string;
  note: string | null;
}): Promise<void> {
  const sentence = `Danke für Ihre Meldung zu ${input.facilityName} – sie ist erledigt.`;
  const text = input.note ? `${sentence}\n\n${input.note}` : sentence;
  await send(
    input.to,
    `Ihre Meldung ist erledigt: ${input.facilityName}`,
    text,
    `<!doctype html><html lang="de"><body style="font-family:system-ui,sans-serif;line-height:1.6"><p>${escapeHtml(sentence)}</p>${input.note ? `<p>${escapeHtml(input.note)}</p>` : ""}</body></html>`,
  );
}

/** Plain e-mail sent by an agent tool. Returns the Message-ID. */
export async function sendRawMail(input: {
  fromName: string;
  to: string[];
  subject: string;
  text: string;
  messageId: string;
}): Promise<string> {
  const from = getEnv().SMTP_FROM;
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  const info = await getTransporter().sendMail({
    from: { name: input.fromName.replace(/["<>]/g, ""), address },
    to: input.to,
    subject: input.subject,
    text: input.text,
    messageId: input.messageId,
  });
  log.info({ to: input.to.length, subject: input.subject }, "agent mail sent");
  return String(info.messageId ?? input.messageId);
}
