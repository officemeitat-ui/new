import Link from "next/link";
import { notFound } from "next/navigation";
import { toggleLearnerAction } from "@/app/app/awareness-actions";
import { AddLearnersForm, ContactsForm, ImpulseDraft, RenewLink } from "@/components/awareness/AdminUI";
import { workspace } from "@/config/workspace";
import { requireAdmin } from "@/lib/auth";
import { SELF_ASSESSMENT } from "@/lib/awareness/content";
import { fillPlaceholders, impulseFor, listAssessments, listLearners, orgContacts, orgName, ratingFor } from "@/lib/awareness/store";
import { outlookConfigured } from "@/lib/workspace/outlook";

const STATE = {
  neu: { label: "nicht begonnen", style: "bg-slate-100 text-slate-700" },
  begonnen: { label: "in Arbeit", style: "bg-sky-100 text-sky-800" },
  bestanden: { label: "bestanden", style: "bg-emerald-100 text-emerald-800" },
  laeuft_ab: { label: "läuft bald ab", style: "bg-amber-100 text-amber-800" },
  abgelaufen: { label: "abgelaufen", style: "bg-red-100 text-red-800" },
};

export default async function AwarenessOrgPage({ params }: PageProps<"/app/awareness/[org]">) {
  const user = await requireAdmin();
  const { org } = await params;
  const name = await orgName(org);
  if (!name) notFound();
  const [learners, contacts, assessments] = await Promise.all([listLearners(org), orgContacts(org), listAssessments(org)]);
  const drafts = outlookConfigured() && user.role === "inhaber";
  const impulse = impulseFor(new Date());
  const date = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeZone: workspace.timeZone }).format(new Date(iso)) : "–";
  const card = "space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200";
  const active = learners.filter((l) => !l.disabled);
  const passed = active.filter((l) => l.state === "bestanden" || l.state === "laeuft_ab").length;

  return (
    <div className="space-y-4">
      <Link href="/app/awareness" className="text-sm text-slate-500 hover:text-slate-900">
        ← Awareness
      </Link>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{name}</h1>
        <span className="text-sm text-slate-600">
          {passed} von {active.length} geschult
        </span>
      </div>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Teilnehmende</h2>
          {learners.length > 0 && (
            <a href={`/app/awareness/${org}/export`} className="text-sm text-brand hover:underline">
              Nachweisliste (CSV)
            </a>
          )}
        </div>
        {learners.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {learners.map((l) => (
              <li key={l.id} className={`flex flex-wrap items-start gap-3 py-2 ${l.disabled ? "opacity-50" : ""}`}>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{l.name}</span> <span className="text-slate-500">{l.email ?? ""}</span>
                  <span className="block text-xs text-slate-500">
                    {l.stepsDone}/{l.stepsTotal} Schritte
                    {l.best ? ` · Quiz ${l.best.score}/${l.best.total}` : ""}
                    {l.validUntil ? ` · gültig bis ${date(l.validUntil)}` : ""}
                    {` · zuletzt aktiv ${date(l.lastSeenAt)}`}
                    {l.invitedAt ? ` · eingeladen ${date(l.invitedAt)}` : ""}
                  </span>
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE[l.state].style}`}>
                  {l.disabled ? "deaktiviert" : STATE[l.state].label}
                </span>
                <span className="flex flex-col items-end gap-1">
                  {l.best?.passed && (
                    <Link href={`/lernen/nachweis/${l.best.id}`} className="text-xs text-brand hover:underline">
                      Nachweis
                    </Link>
                  )}
                  <RenewLink learnerId={l.id} drafts={drafts && Boolean(l.email)} />
                  <form action={toggleLearnerAction}>
                    <input type="hidden" name="learnerId" value={l.id} />
                    <button type="submit" className="text-xs text-slate-400 hover:text-slate-700">
                      {l.disabled ? "Reaktivieren" : "Deaktivieren"}
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
        <AddLearnersForm org={org} drafts={drafts} />
      </section>

      <section className={card}>
        <h2 className="font-semibold">Kontakte in der Schulung</h2>
        <p className="text-sm text-slate-600">Erscheinen in der Schulung und auf dem Aushang („Verdacht? Sofort melden!“).</p>
        <ContactsForm org={org} contacts={contacts} />
        <Link href={`/app/awareness/${org}/aushang`} className="inline-block text-sm text-brand hover:underline">
          Aushang STOPP · PRÜFEN · BESTÄTIGEN (zum Drucken)
        </Link>
      </section>

      <section className={card}>
        <p className="text-xs font-semibold tracking-wide text-sky-700 uppercase">Impuls des Monats</p>
        <h2 className="font-semibold">{impulse.title}</h2>
        {impulse.action && <p className="text-sm text-slate-600">Dazu passend: {impulse.action}</p>}
        <details>
          <summary className="cursor-pointer text-sm text-brand">Text anzeigen</summary>
          <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-line">{fillPlaceholders(impulse.text, name, contacts)}</p>
        </details>
        {drafts && active.some((l) => l.email) && <ImpulseDraft org={org} />}
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Selbstbewertung „Wie gut sind wir gegen KI-Angriffe geschützt?“</h2>
          <Link href={`/app/awareness/${org}/selbstbewertung`} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white">
            {assessments.length ? "Neu bewerten" : "Jetzt bewerten"}
          </Link>
        </div>
        {assessments.length ? (
          <ul className="text-sm">
            {assessments.slice(0, 5).map((a) => (
              <li key={a.id} className="flex justify-between border-t border-slate-100 py-1.5">
                <span>
                  {date(a.createdAt)} · {a.createdBy ?? ""}
                </span>
                <span className="font-medium">
                  {a.score}/{SELF_ASSESSMENT.max} · {ratingFor(a.score).label}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            {SELF_ASSESSMENT.sections.length} Bereiche, {SELF_ASSESSMENT.max} Punkte – ideal als Einstieg ins Beratungsgespräch und für
            NIS2.
          </p>
        )}
      </section>
    </div>
  );
}
