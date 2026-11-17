"use client";

import { useActionState } from "react";
import { createQuoteAction, quoteDraftAction } from "@/app/app/angebote/actions";
import { Submit } from "@/components/workspace/Forms";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm focus:border-brand focus:outline-none";

export function NewQuoteForm({
  customers,
  services,
  customerId,
  need,
  codes,
}: {
  customers: { id: string; name: string }[];
  services: { code: string; name: string; recurring: boolean }[];
  customerId?: string;
  need?: string;
  codes: string[];
}) {
  const [state, action, pending] = useActionState(createQuoteAction, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium">
        Kunde
        <select name="customerId" defaultValue={customerId} required className={input}>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Bedarf / Gesprächsnotizen
        <textarea
          name="need"
          rows={5}
          defaultValue={need}
          required
          placeholder="z. B. „12 Arbeitsplätze, viele Druckerprobleme, will planbare Kosten. Backup derzeit nur USB-Platte. Interesse an KI, aber nur ohne Cloud.“"
          className={input}
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Leistungen vorgeben (optional – sonst wählt die KI)</legend>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <label key={s.code} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="codes" value={s.code} defaultChecked={codes.includes(s.code)} />
              {s.name}
              {s.recurring && <span className="text-xs text-slate-400">mtl.</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="tiers" defaultChecked /> In drei Paketen anbieten (Premium · Einstieg · Empfehlung)
      </label>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="rounded-lg bg-brand px-5 py-2.5 font-semibold text-white disabled:opacity-60">
        {pending ? "Angebot wird erstellt …" : "Angebot erstellen"}
      </button>
    </form>
  );
}

export function QuoteDraftButton({ id }: { id: string }) {
  const [state, action] = useActionState(quoteDraftAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Submit className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
        Als Outlook-Entwurf
      </Submit>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.message && <p className="text-sm text-emerald-700">{state.message}</p>}
    </form>
  );
}
