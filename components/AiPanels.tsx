"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { createBriefing, createFollowUp, type AiState } from "@/app/admin/actions";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function ErrorMessage({ state }: { state: AiState }) {
  return state.error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null;
}

export function BriefingForm({ leadId, hasBriefing }: { leadId: string; hasBriefing: boolean }) {
  const [state, action] = useActionState(createBriefing, {});
  return (
    <form action={action}>
      <input type="hidden" name="leadId" value={leadId} />
      <SubmitButton label={hasBriefing ? "Neu erstellen" : "Gesprächsvorbereitung erstellen"} pendingLabel="KI arbeitet …" />
      <ErrorMessage state={state} />
    </form>
  );
}

export function FollowUpForm({ leadId }: { leadId: string }) {
  const [state, action] = useActionState(createFollowUp, {});
  // Kontrolliertes Feld, damit die Notizen bei einem Fehler nicht verloren gehen.
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (state.ok) setNotes("");
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="leadId" value={leadId} />
      <textarea
        name="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={6}
        placeholder="Gesprächsnotizen oder Transkript einfügen …"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
      />
      <SubmitButton label="Auswerten & Follow-up entwerfen" pendingLabel="KI arbeitet …" />
      <ErrorMessage state={state} />
    </form>
  );
}

export function CopyButton({ text, label = "Kopieren" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
    >
      {copied ? "Kopiert ✓" : label}
    </button>
  );
}
