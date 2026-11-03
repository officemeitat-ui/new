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
