"use client";

import { usePathname, useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { changeDocPassword, lockDocs, setupDocVault, unlockDocs, type VaultActionState } from "@/app/app/vault-actions";
import { Submit } from "@/components/workspace/Forms";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand focus:outline-none";

function Feedback({ state }: { state: VaultActionState }) {
  if (state.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
  return null;
}

const Lock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6" aria-hidden>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);

/** Sperrbildschirm: die Dokumentation ist verschlüsselt und wird erst mit dem Doku-Passwort lesbar. */
export function UnlockScreen() {
  const pathname = usePathname();
  const [state, action] = useActionState(unlockDocs, {});
  return (
    <div className="mx-auto mt-6 max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center gap-3 text-slate-900">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white">
          <Lock />
        </span>
        <div>
          <h1 className="text-lg font-bold">Dokumentation gesperrt</h1>
          <p className="text-sm text-slate-500">Verschlüsselt gespeichert – bitte mit dem Doku-Passwort öffnen.</p>
        </div>
      </div>
      <form action={action} className="mt-5 space-y-3">
        <input type="hidden" name="next" value={pathname} />
        <input
          name="secret"
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Doku-Passwort"
          className={input}
          aria-label="Doku-Passwort"
        />
        <Feedback state={state} />
        <Submit className="w-full rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
          Entsperren
        </Submit>
        <p className="text-xs text-slate-500">Passwort vergessen? Der Wiederherstellungsschlüssel funktioniert hier auch.</p>
      </form>
    </div>
  );
}

/**
 * Kopfbereich der Doku: Einrichtung (noch unverschlüsselt) bzw. Leiste (entsperrt). Eine Komponente für beide Zustände,
 * damit der Wiederherstellungsschlüssel stehen bleibt, wenn die Seite nach dem Einrichten neu gerendert wird.
 */
export function VaultPanel({ access, minutes }: { access: "offen" | "entsperrt"; minutes: number }) {
  const [state, action] = useActionState(setupDocVault, {});
  const [confirmed, setConfirmed] = useState(false);
  if (state.recoveryCode && !confirmed) return <RecoveryCode code={state.recoveryCode} onDone={() => setConfirmed(true)} />;
  if (access === "entsperrt") return <VaultBar minutes={minutes} />;
  return <VaultSetup state={state} action={action} />;
}

function RecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  return (
    <section className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
      <h2 className="font-semibold text-emerald-900">Tresor eingerichtet – alle Daten sind jetzt verschlüsselt</h2>
      <p className="mt-1 text-sm text-emerald-900">
        Das ist der <strong>Wiederherstellungsschlüssel</strong>. Er wird nur dieses eine Mal angezeigt. Ohne Passwort und ohne diesen
        Schlüssel kann niemand – auch wir nicht – die Dokumentation wieder öffnen. Bitte in Keeper ablegen.
      </p>
      <p className="mt-3 rounded-lg bg-white px-3 py-3 text-center font-mono text-lg tracking-wider ring-1 ring-emerald-200 select-all">
        {code}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true))}
          className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-medium"
        >
          {copied ? "Kopiert ✓" : "Kopieren"}
        </button>
        <button
          type="button"
          onClick={() => {
            onDone();
            router.refresh();
          }}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
        >
          Gespeichert – weiter
        </button>
      </div>
    </section>
  );
}

/** Einrichtung des Tresors – solange die Dokumentation noch unverschlüsselt ist. */
function VaultSetup({ state, action }: { state: VaultActionState; action: (formData: FormData) => void }) {
  return (
    <section className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <h2 className="font-semibold text-amber-900">Dokumentation verschlüsseln</h2>
      <p className="mt-1 text-sm text-amber-900">
        Noch liegt die Dokumentation unverschlüsselt in der Datenbank. Mit einem eigenen Doku-Passwort wird alles verschlüsselt (AES-256) –
        auch Sicherungen sind ohne Passwort wertlos. Nach dem Entsperren bleibt sie 30 Minuten offen.
      </p>
      <form action={action} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Doku-Passwort (mind. 12 Zeichen)"
          className={input}
          aria-label="Doku-Passwort"
        />
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="wiederholen"
          className={input}
          aria-label="Doku-Passwort wiederholen"
        />
        <Submit>Verschlüsseln</Submit>
        <div className="sm:col-span-3">
          <Feedback state={state} />
        </div>
      </form>
    </section>
  );
}

/** Leiste im entsperrten Zustand: sperren und Passwort ändern. */
function VaultBar({ minutes }: { minutes: number }) {
  const [state, action] = useActionState(changeDocPassword, {});
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-slate-100">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2">
          <Lock /> Tresor entsperrt – sperrt sich nach {minutes} Minuten von selbst.
        </span>
        <span className="flex-1" />
        <button type="button" onClick={() => setOpen(!open)} className="text-slate-300 hover:text-white">
          Passwort ändern
        </button>
        <form action={lockDocs}>
          <button type="submit" className="rounded-lg bg-white px-3 py-1 font-semibold text-slate-900">
            Jetzt sperren
          </button>
        </form>
      </div>
      {open && (
        <form action={action} className="grid gap-2 pb-1 sm:grid-cols-[1fr_1fr_auto]">
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="neues Doku-Passwort"
            className={`${input} text-slate-900`}
          />
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="wiederholen"
            className={`${input} text-slate-900`}
          />
          <Submit>Ändern</Submit>
          <div className="sm:col-span-3">
            <Feedback state={state} />
          </div>
        </form>
      )}
    </div>
  );
}
