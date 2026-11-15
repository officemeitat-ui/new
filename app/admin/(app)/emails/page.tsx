import Link from "next/link";
import { business } from "@/config/business";
import { EmailDraftForm, SimulateEmailForm } from "@/components/EmailPanels";
import { retryEmail } from "@/app/admin/assistant-actions";
import { requireAdmin } from "@/lib/auth";
import { EMAIL_CATEGORIES, listEmails, type Email, type EmailStatus } from "@/lib/emails";
import { formatDateTime } from "@/lib/format";
import { imapConfigured } from "@/lib/mail/imap";
import { smtpConfigured } from "@/lib/mail/smtp";

const TABS: { id: string; label: string; statuses: EmailStatus[] }[] = [
  { id: "offen", label: "Zur Freigabe", statuses: ["entwurf", "fehler"] },
  { id: "gesendet", label: "Gesendet", statuses: ["gesendet"] },
  { id: "erledigt", label: "Erledigt", statuses: ["erledigt", "verworfen"] },
];

const statusLabel: Record<EmailStatus, string> = {
  neu: "Neu",
  entwurf: "Entwurf",
  gesendet: "Gesendet",
  erledigt: "Erledigt",
  verworfen: "Verworfen",
  fehler: "Fehler",
};

function EmailCard({ email, canSend }: { email: Email; canSend: boolean }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{email.subject}</p>
          <p className="text-sm text-slate-500">
            {email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress} · {formatDateTime(email.receivedAt)}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {email.category && (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand">{EMAIL_CATEGORIES[email.category]}</span>
          )}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{statusLabel[email.status]}</span>
        </div>
      </header>
      {email.summary && <p className="mt-3 text-sm text-slate-700">{email.summary}</p>}
      {email.leadId && (
        <Link href={`/admin/leads/${email.leadId}`} className="mt-1 inline-block text-sm font-medium text-brand hover:underline">
          Zum Kontakt →
        </Link>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-500">Original-E-Mail</summary>
        <p className="mt-2 rounded-lg bg-slate-50 p-3 whitespace-pre-wrap text-slate-700">{email.body}</p>
      </details>

      {email.status === "entwurf" && email.replyBody && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <EmailDraftForm
            emailId={email.id}
            to={email.fromAddress}
            subject={email.replySubject ?? ""}
            body={email.replyBody}
            canSend={canSend}
          />
        </div>
      )}
      {email.status === "fehler" && (
        <form action={retryEmail} className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
          <input type="hidden" name="emailId" value={email.id} />
          <p className="flex-1 text-sm text-red-700">{email.error}</p>
          <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
            Erneut auswerten
          </button>
        </form>
      )}
      {email.status === "gesendet" && email.replyBody && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-slate-500">
            Gesendete Antwort {email.sentAt && `(${formatDateTime(email.sentAt)})`}
          </summary>
          <p className="mt-2 rounded-lg bg-slate-50 p-3 whitespace-pre-wrap text-slate-700">{email.replyBody}</p>
        </details>
      )}
    </article>
  );
}

export default async function EmailsPage({ searchParams }: PageProps<"/admin/emails">) {
  await requireAdmin();
  const { tab: tabParam } = await searchParams;
  const tab = TABS.find((t) => t.id === tabParam) ?? TABS[0];
  const emails = await listEmails(tab.statuses);
  const canSend = smtpConfigured();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">E-Mail-Assistent</h1>
          <p className="text-sm text-slate-500">
            Modus: {business.emailAssistant.mode === "autonom" ? "autonom für Routineanfragen" : "alle Antworten zur Freigabe"} · Postfach{" "}
            {imapConfigured() ? "verbunden" : "nicht verbunden"} · Versand {canSend ? "eingerichtet" : "nicht eingerichtet"}
          </p>
        </div>
        <nav className="flex gap-1 rounded-lg bg-slate-200/60 p-1 text-sm font-medium">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/admin/emails?tab=${t.id}`}
              className={`rounded-md px-3 py-1.5 ${t.id === tab.id ? "bg-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      <details className="rounded-xl border border-dashed border-slate-300 bg-white p-5">
        <summary className="cursor-pointer font-semibold">Test-E-Mail simulieren (für Vorführungen)</summary>
        <div className="mt-4">
          <SimulateEmailForm />
        </div>
      </details>

      {emails.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">Keine E-Mails in dieser Ansicht.</p>
      ) : (
        <div className="space-y-4">
          {emails.map((email) => (
            <EmailCard key={email.id} email={email} canSend={canSend} />
          ))}
        </div>
      )}
    </div>
  );
}
