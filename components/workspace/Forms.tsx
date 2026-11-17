"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { addTask, saveCustomer, summarizeTicket, syncNow, toggleTask, type BriefState, type WorkspaceActionState } from "@/app/app/actions";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm focus:border-brand focus:outline-none";

function Feedback({ state }: { state: WorkspaceActionState }) {
  if (state.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
  return null;
}

export function Submit({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className ?? "rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"}
    >
      {pending ? "…" : children}
    </button>
  );
}

/** Schnelles Anlegen: Titel genügt, Details bei Bedarf aufklappen. */
export function QuickAddTask({
  lists,
  customers,
  customerId,
  ticketId,
  defaultTitle,
}: {
  lists: string[];
  customers: { id: string; name: string }[];
  customerId?: string;
  ticketId?: string;
  defaultTitle?: string;
}) {
  const [state, action] = useActionState(addTask, {});
  const [open, setOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="space-y-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      {ticketId && <input type="hidden" name="ticketId" value={ticketId} />}
      <div className="flex gap-2">
        <input name="title" defaultValue={defaultTitle} placeholder="Neue Aufgabe …" className={input} aria-label="Titel der Aufgabe" />
        <Submit>Anlegen</Submit>
      </div>
      <button type="button" onClick={() => setOpen(!open)} className="text-sm text-slate-500 hover:text-slate-900">
        {open ? "Weniger" : "Fälligkeit, Kunde, Liste …"}
      </button>
      <div className={open ? "grid gap-3 sm:grid-cols-3" : "hidden"}>
        <label className="text-xs text-slate-500">
          Fällig am
          <input type="date" name="dueDate" className={input} />
        </label>
        <label className="text-xs text-slate-500">
          Uhrzeit
          <input type="time" name="dueTime" className={input} />
        </label>
        <label className="text-xs text-slate-500">
          Priorität
          <select name="priority" defaultValue="normal" className={input}>
            <option value="hoch">Hoch</option>
            <option value="normal">Normal</option>
            <option value="niedrig">Niedrig</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Liste
          <select name="listName" className={input}>
            {lists.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Kunde
          <select name="customerId" defaultValue={customerId ?? ""} className={input}>
            <option value="">–</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Wiederholen
          <select name="recurrence" className={input}>
            <option value="">nie</option>
            <option value="taeglich">täglich</option>
            <option value="woechentlich">wöchentlich</option>
            <option value="monatlich">monatlich</option>
          </select>
        </label>
        <label className="text-xs text-slate-500 sm:col-span-3">
          Notiz
          <textarea name="notes" rows={2} className={input} />
        </label>
      </div>
      <Feedback state={state} />
    </form>
  );
}

/** Abhaken mit einem Tipp. */
export function TaskCheck({ id, done, label }: { id: string; done: boolean; label: string }) {
  return (
    <form action={toggleTask}>
      <input type="hidden" name="id" value={id} />
      <CheckButton done={done} label={label} />
    </form>
  );
}

function CheckButton({ done, label }: { done: boolean; label: string }) {
  const { pending } = useFormStatus();
  const checked = pending ? !done : done;
  return (
    <button
      type="submit"
      aria-label={done ? `„${label}“ wieder öffnen` : `„${label}“ erledigen`}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
        checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 hover:border-brand"
      }`}
    >
      {checked && (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
          <path d="M7.6 13.4 4.2 10l-1.2 1.2 4.6 4.6 9.8-9.8-1.2-1.2z" />
        </svg>
      )}
    </button>
  );
}

export function SyncButton({ todo }: { todo: boolean }) {
  const [state, action] = useActionState(syncNow, {});
  return (
    <form action={action} className="space-y-2">
      {todo && (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="todo" value="1" /> offene Aufgaben aus Microsoft To Do übernehmen
        </label>
      )}
      <Submit className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
        Jetzt abgleichen
      </Submit>
      <Feedback state={state} />
    </form>
  );
}

export function CustomerForm({
  customer,
}: {
  customer: {
    id: string;
    domains: string[];
    email: string | null;
    phone: string | null;
    address: string | null;
    keeperUrl: string | null;
    notes: string | null;
  };
}) {
  const [state, action] = useActionState(saveCustomer, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={customer.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-500">
          E-Mail (für Entwürfe des Assistenten)
          <input name="email" type="email" defaultValue={customer.email ?? ""} className={input} />
        </label>
        <label className="text-xs text-slate-500">
          Telefon
          <input name="phone" defaultValue={customer.phone ?? ""} className={input} />
        </label>
        <label className="text-xs text-slate-500">
          Adresse (Ort für Vor-Ort-Termine)
          <input name="address" defaultValue={customer.address ?? ""} className={input} />
        </label>
        <label className="text-xs text-slate-500">
          E-Mail-Domains (kommagetrennt)
          <input name="domains" defaultValue={customer.domains.join(", ")} placeholder="kunde.at" className={input} />
        </label>
        <label className="text-xs text-slate-500 sm:col-span-2">
          Keeper-Link (geteilter Ordner oder Datensatz – nie Passwörter hier eintragen)
          <input
            name="keeperUrl"
            type="url"
            defaultValue={customer.keeperUrl ?? ""}
            placeholder="https://keepersecurity.eu/vault/#…"
            className={input}
          />
        </label>
        <label className="text-xs text-slate-500 sm:col-span-2">
          Notizen (Umgebung, Ansprechpartner, Besonderheiten)
          <textarea name="notes" rows={4} defaultValue={customer.notes ?? ""} className={input} />
        </label>
      </div>
      <Feedback state={state} />
      <Submit>Speichern</Submit>
    </form>
  );
}

export function TicketBriefPanel({ ticketId }: { ticketId: string }) {
  const [state, action] = useActionState<BriefState, FormData>(summarizeTicket, {});
  const [copied, setCopied] = useState(false);
  const brief = state.brief;
  return (
    <div className="space-y-3">
      <form action={action}>
        <input type="hidden" name="id" value={ticketId} />
        <Submit>{brief ? "Neu zusammenfassen" : "KI: Zusammenfassen & Antwort vorschlagen"}</Submit>
      </form>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {brief && (
        <div className="space-y-3 text-sm">
          <p>{brief.zusammenfassung}</p>
          {brief.naechsteSchritte.length > 0 && (
            <div>
              <p className="font-semibold">Nächste Schritte (ca. {brief.aufwandMinuten} Min.)</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                {brief.naechsteSchritte.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          {brief.rueckfragen.length > 0 && (
            <div>
              <p className="font-semibold">Beim Kunden klären</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {brief.rueckfragen.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {brief.antwortVorschlag && (
            <div className="space-y-2">
              <p className="font-semibold">Antwortvorschlag</p>
              <p className="rounded-lg bg-slate-50 p-3 whitespace-pre-wrap">{brief.antwortVorschlag}</p>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(brief.antwortVorschlag).then(() => setCopied(true));
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                {copied ? "Kopiert ✓" : "Antwort kopieren (für Atera)"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Meldet den Service Worker an – Voraussetzung, damit sich der Arbeitsplatz als App installieren lässt. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    }
  }, []);
  return null;
}
