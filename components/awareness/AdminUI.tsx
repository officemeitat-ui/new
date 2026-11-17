"use client";

import { useActionState, useMemo, useState } from "react";
import {
  addLearnersAction,
  impulseDraftAction,
  renewLinkAction,
  saveAssessmentAction,
  saveContactsAction,
  type AwarenessState,
} from "@/app/app/awareness-actions";
import { Submit } from "@/components/workspace/Forms";
import type { SelfAssessment } from "@/lib/awareness/content";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm focus:border-brand focus:outline-none";
const secondary = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60";

function Feedback({ state }: { state: AwarenessState }) {
  if (state.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
  return null;
}

function Links({ links }: { links: NonNullable<AwarenessState["links"]> }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!links.length) return null;
  const all = links.map((l) => `${l.name}${l.email ? ` <${l.email}>` : ""}: ${l.url}`).join("\n");
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-slate-100 rounded-lg bg-slate-50 text-sm ring-1 ring-slate-200">
        {links.map((link) => (
          <li key={link.url} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{link.name}</span>
              <span className="block truncate font-mono text-xs text-slate-500">{link.url}</span>
            </span>
            <button
              type="button"
              className={secondary}
              onClick={() => void navigator.clipboard.writeText(link.url).then(() => setCopied(link.url))}
            >
              {copied === link.url ? "Kopiert ✓" : "Kopieren"}
            </button>
          </li>
        ))}
      </ul>
      {links.length > 1 && (
        <button type="button" className={secondary} onClick={() => void navigator.clipboard.writeText(all).then(() => setCopied("alle"))}>
          {copied === "alle" ? "Alle kopiert ✓" : "Alle Links kopieren"}
        </button>
      )}
    </div>
  );
}

export function ContactsForm({ org, contacts }: { org: string; contacts: { meldestelle: string; notfall: string; hausbank: string } }) {
  const [state, action] = useActionState(saveContactsAction, {});
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-3">
      <input type="hidden" name="org" value={org} />
      <label className="text-xs text-slate-500">
        Verdacht melden an
        <input name="meldestelle" defaultValue={contacts.meldestelle} placeholder="z. B. IT: 0732 123 456, it@firma.at" className={input} />
      </label>
      <label className="text-xs text-slate-500">
        Außerhalb der Bürozeiten
        <input name="notfall" defaultValue={contacts.notfall} placeholder="z. B. Notfallnummer 0664 …" className={input} />
      </label>
      <label className="text-xs text-slate-500">
        Hausbank (bei Fehlüberweisung)
        <input name="hausbank" defaultValue={contacts.hausbank} placeholder="z. B. Raiffeisen Betreuerin 0732 …" className={input} />
      </label>
      <div className="sm:col-span-3">
        <Submit>Kontakte speichern</Submit>
      </div>
      <div className="sm:col-span-3">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function AddLearnersForm({ org, drafts }: { org: string; drafts: boolean }) {
  const [state, action] = useActionState(addLearnersAction, {});
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-2">
        <input type="hidden" name="org" value={org} />
        <textarea
          name="list"
          rows={4}
          placeholder={
            "Je Zeile: Name; E-Mail – auch direkt aus Excel kopiert\nMaria Huber; maria.huber@huber-stb.at\nPeter Gruber; p.gruber@huber-stb.at"
          }
          className={`${input} font-mono`}
          aria-label="Teilnehmende"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Submit>Teilnehmende anlegen</Submit>
          {drafts && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="drafts" defaultChecked /> Einladungen als Entwürfe in Outlook
            </label>
          )}
        </div>
      </form>
      <Feedback state={state} />
      {state.links && <Links links={state.links} />}
    </div>
  );
}

export function RenewLink({ learnerId, drafts }: { learnerId: string; drafts: boolean }) {
  const [state, action] = useActionState(renewLinkAction, {});
  return (
    <div className="space-y-1">
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="learnerId" value={learnerId} />
        {drafts && <input type="hidden" name="draft" value="on" />}
        <button type="submit" className="text-xs text-brand hover:underline">
          {drafts ? "Neuer Link + Einladung" : "Neuer Link"}
        </button>
      </form>
      {state.links && <Links links={state.links} />}
      {state.error && <p className="text-xs text-red-700">{state.error}</p>}
    </div>
  );
}

export function ImpulseDraft({ org }: { org: string }) {
  const [state, action] = useActionState(impulseDraftAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="org" value={org} />
      <Submit className={secondary}>Als Outlook-Entwurf an alle (BCC)</Submit>
      <Feedback state={state} />
    </form>
  );
}

/** Selbstbewertung mit Live-Punkten; gespeichert wird jede Durchführung (Verlauf). */
export function AssessmentForm({ org, assessment, initial }: { org: string; assessment: SelfAssessment; initial: Record<string, number> }) {
  const [state, action] = useActionState(saveAssessmentAction, {});
  const [answers, setAnswers] = useState<Record<string, number>>(initial);
  const score = useMemo(
    () => assessment.sections.flatMap((s) => s.questions).reduce((sum, q) => sum + (answers[q.id] ?? 0), 0),
    [answers, assessment],
  );
  const answered = Object.keys(answers).length;
  const total = assessment.sections.reduce((n, s) => n + s.questions.length, 0);
  const rating = [...assessment.ratings].sort((a, b) => b.min - a.min).find((r) => score >= r.min) ?? assessment.ratings[0];
  const gaps = assessment.sections.flatMap((s) => s.questions).filter((q) => q.key && answers[q.id] === 0);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="org" value={org} />
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:rounded-xl md:border-0 md:bg-white md:ring-1 md:ring-slate-200">
        <span className="text-lg font-bold">
          {score} / {assessment.max}
        </span>
        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">{rating.label}</span>
        <span className="text-xs text-slate-500">
          {answered}/{total} beantwortet
        </span>
        <span className="flex-1" />
        <Submit>Bewertung speichern</Submit>
      </div>
      <Feedback state={state} />
      {gaps.length > 0 && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {gaps.length} Kernfrage(n) mit „Nein“ – das sind die dringendsten Lücken: {gaps.map((q) => q.id).join(", ")}
        </p>
      )}
      {assessment.sections.map((section) => {
        const sectionScore = section.questions.reduce((sum, q) => sum + (answers[q.id] ?? 0), 0);
        return (
          <fieldset key={section.id} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <legend className="sr-only">{section.title}</legend>
            <div className="flex items-baseline justify-between">
              <h3 className="font-semibold">{section.title}</h3>
              <span className="text-sm text-slate-500">
                {sectionScore}/{section.max}
              </span>
            </div>
            {section.questions.map((q) => (
              <div key={q.id} className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="text-slate-400">{q.id}</span> {q.key && <span title="Kernfrage">★</span>} {q.text}
                </span>
                <span className="flex gap-1">
                  {assessment.scale.map((option) => (
                    <label
                      key={option.points}
                      className="cursor-pointer rounded-lg px-2.5 py-1 text-xs ring-1 ring-slate-200 has-[:checked]:bg-slate-900 has-[:checked]:text-white"
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={option.points}
                        checked={answers[q.id] === option.points}
                        onChange={() => setAnswers({ ...answers, [q.id]: option.points })}
                        className="sr-only"
                      />
                      {option.label}
                    </label>
                  ))}
                </span>
              </div>
            ))}
          </fieldset>
        );
      })}
    </form>
  );
}
