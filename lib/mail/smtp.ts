import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | undefined;

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function transport(): Transporter {
  if (!smtpConfigured()) throw new Error("SMTP ist nicht konfiguriert (SMTP_HOST, SMTP_FROM)");
  const port = Number(process.env.SMTP_PORT || 587);
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

export async function sendMail(message: { to: string; subject: string; text: string; inReplyTo?: string | null }): Promise<void> {
  await transport().sendMail({
    from: process.env.SMTP_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.inReplyTo ? { inReplyTo: message.inReplyTo, references: [message.inReplyTo] } : {}),
  });
}

/** Kurze Info an das Team (TEAM_NOTIFY_EMAIL), z. B. bei Rückrufwünschen. Fehler werden nur protokolliert. */
export async function notifyTeam(subject: string, text: string): Promise<void> {
  const to = process.env.TEAM_NOTIFY_EMAIL;
  if (!to || !smtpConfigured()) return;
  try {
    await sendMail({ to, subject, text });
  } catch (error) {
    console.error("Team-Benachrichtigung fehlgeschlagen:", error);
  }
}
