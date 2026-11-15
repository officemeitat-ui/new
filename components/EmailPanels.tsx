"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { handleEmailDraft, runFollowUps, simulateEmail, type ActionState } from "@/app/admin/assistant-actions";
import { CopyButton } from "@/components/AiPanels";

function IntentButton({ intent, children, primary }: { intent: string; children: React.ReactNode; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      disabled={pending}
      className={
        primary
          ? "rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
          : "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
      }
    >
      {children}
    </button>
  );
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
  return null;
}

export function EmailDraftForm({
  emailId,
  to,
  subject,
  body,
  canSend,
}: {
  emailId: string;
  to: string;
  subject: string;
  body: string;
  canSend: boolean;
}) {
  const [state, action] = useActionState(handleEmailDraft, {});
  // Kontrollierte Felder, damit Bearbeitungen bei einem Fehler nicht verloren gehen.
  const [draftSubject, setDraftSubject] = useState(subject);
  const [draftBody, setDraftBody] = useState(body);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="emailId" value={emailId} />
      <label className="block">
        <span className="text-xs font-medium text-slate-500">Betreff</span>
        <input
          name="subject"
          value={draftSubject}
          onChange={(e) => setDraftSubject(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-slate-500">Antwort an {to}</span>
        <textarea
          name="body"
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={9}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <Feedback state={state} />
      <div className="flex flex-wrap items-center gap-2">
        {canSend ? (
          <IntentButton intent="send" primary>
            Freigeben & senden
          </IntentButton>
        ) : (
          <>
            <CopyButton text={`${draftSubject}\n\n${draftBody}`} label="Text kopieren" />
            <a
              href={`mailto:${to}?subject=${encodeURIComponent(draftSubject)}&body=${encodeURIComponent(draftBody)}`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
            >
              Im Mailprogramm öffnen
            </a>
          </>
        )}
        <IntentButton intent="done">Erledigt</IntentButton>
        <IntentButton intent="discard">Verwerfen</IntentButton>
      </div>
    </form>
  );
}

const SAMPLE = {
  fromName: "Peter Berger",
  fromAddress: "peter.berger@example.com",
  subject: "Pickerl für meinen Golf",
  body: "Grüß Gott,\n\nmein VW Golf braucht nächste Woche das Pickerl. Hätten Sie am Dienstag oder Mittwoch Vormittag Zeit? Gibt es ein Ersatzauto?\n\nLG Peter Berger\n0676 555 12 34",
};

export function SimulateEmailForm() {
  const [state, action, pending] = useActionState(simulateEmail, {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          name="fromName"
          defaultValue={SAMPLE.fromName}
          placeholder="Name"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          name="fromAddress"
          defaultValue={SAMPLE.fromAddress}
          placeholder="E-Mail"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <input name="subject" defaultValue={SAMPLE.subject} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <textarea name="body" defaultValue={SAMPLE.body} rows={6} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <Feedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? "KI arbeitet …" : "Test-E-Mail durch den Assistenten schicken"}
      </button>
    </form>
  );
}

export function FollowUpButton() {
  const [state, action, pending] = useActionState<ActionState>(runFollowUps, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "KI arbeitet …" : "Offene Anfragen nachfassen"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
