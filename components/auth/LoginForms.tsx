"use client";

import { useActionState, useState } from "react";
import { cancelLogin, confirmSetup, finishLogin, firstSetup, passwordLogin, verifyCode } from "@/app/admin/login/actions";
import { Submit } from "@/components/workspace/Forms";

const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-brand focus:outline-none";
const primary = "w-full rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-60";

function ErrorText({ text }: { text?: string }) {
  return text ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{text}</p> : null;
}

export function FirstSetupForm() {
  const [state, action] = useActionState(firstSetup, {});
  return (
    <form action={action} className="mt-6 space-y-3">
      <p className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
        Willkommen! Lege das erste Konto an (Inhaber/in). Zur Bestätigung brauchst du das Einrichtungspasswort aus der Server-Konfiguration
        (<code>ADMIN_PASSWORD</code>). Danach richtest du den zweiten Faktor ein.
      </p>
      <label className="block text-sm font-medium">
        Einrichtungspasswort
        <input name="adminPassword" type="password" required autoComplete="off" className={input} />
      </label>
      <label className="block text-sm font-medium">
        Name
        <input name="name" required autoComplete="name" defaultValue={state.name} className={input} />
      </label>
      <label className="block text-sm font-medium">
        E-Mail (am besten die Microsoft-365-Adresse)
        <input name="email" type="email" required autoComplete="email" defaultValue={state.email} className={input} />
      </label>
      <label className="block text-sm font-medium">
        Neues Passwort (mind. 12 Zeichen)
        <input name="password" type="password" required minLength={12} autoComplete="new-password" className={input} />
      </label>
      <label className="block text-sm font-medium">
        Passwort wiederholen
        <input name="confirm" type="password" required minLength={12} autoComplete="new-password" className={input} />
      </label>
      <ErrorText text={state.error} />
      <Submit className={primary}>Konto anlegen</Submit>
    </form>
  );
}

export function PasswordForm({ next }: { next: string }) {
  const [state, action] = useActionState(passwordLogin, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm font-medium">
        E-Mail
        <input name="email" type="email" required autoComplete="username" defaultValue={state.email} className={input} />
      </label>
      <label className="block text-sm font-medium">
        Passwort
        <input name="password" type="password" required autoComplete="current-password" className={input} />
      </label>
      <ErrorText text={state.error} />
      <Submit className={primary}>Weiter</Submit>
    </form>
  );
}

export function CodeForm({ name }: { name: string }) {
  const [state, action] = useActionState(verifyCode, {});
  const [recovery, setRecovery] = useState(false);
  return (
    <div className="mt-6 space-y-3">
      <p className="text-sm text-slate-600">
        Hallo {name}!{" "}
        {recovery ? "Gib einen deiner Wiederherstellungscodes ein." : "Gib den 6-stelligen Code aus deiner Authenticator-App ein."}
      </p>
      <form action={action} className="space-y-3">
        <input
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode={recovery ? "text" : "numeric"}
          pattern={recovery ? undefined : "[0-9 ]{6,7}"}
          placeholder={recovery ? "XXXXX-XXXXX" : "123 456"}
          aria-label={recovery ? "Wiederherstellungscode" : "Code"}
          className={`${input} text-center font-mono text-xl tracking-widest`}
        />
        <ErrorText text={state.error} />
        <Submit className={primary}>Anmelden</Submit>
      </form>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={() => setRecovery(!recovery)} className="text-slate-500 hover:text-slate-900">
          {recovery ? "Code aus der App verwenden" : "Handy nicht zur Hand?"}
        </button>
        <form action={cancelLogin}>
          <button type="submit" className="text-slate-500 hover:text-slate-900">
            Abbrechen
          </button>
        </form>
      </div>
    </div>
  );
}

/** Einrichtung des zweiten Faktors. Bleibt nach dem Bestätigen stehen, um die Wiederherstellungscodes einmalig zu zeigen. */
export function MfaSetup({ name, qrSvg, secret }: { name: string; qrSvg: string | null; secret: string | null }) {
  const [state, action] = useActionState(confirmSetup, {});
  if (state.recoveryCodes) {
    return (
      <div className="mt-6 space-y-3">
        <h2 className="font-semibold text-emerald-800">Zweiter Faktor ist aktiv ✓</h2>
        <p className="text-sm text-slate-600">
          Das sind deine <strong>Wiederherstellungscodes</strong> – jeder funktioniert einmal, falls das Handy fehlt. Sie werden nur jetzt
          angezeigt: in Keeper ablegen oder ausdrucken.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 font-mono text-sm ring-1 ring-slate-200">
          {state.recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <form action={finishLogin}>
          <input type="hidden" name="next" value={state.next ?? "/app"} />
          <button type="submit" className={primary}>
            Gespeichert – weiter
          </button>
        </form>
      </div>
    );
  }
  return (
    <div className="mt-6 space-y-3">
      <p className="text-sm text-slate-600">
        {name}, für dein Konto ist ein zweiter Faktor Pflicht. Scanne den QR-Code mit Microsoft Authenticator (oder Keeper, Google
        Authenticator, 1Password) und gib den angezeigten Code ein.
      </p>
      {qrSvg && <div className="mx-auto w-48 rounded-lg bg-white p-2 ring-1 ring-slate-200" dangerouslySetInnerHTML={{ __html: qrSvg }} />}
      {secret && (
        <p className="text-center text-xs text-slate-500">
          Manuell: <span className="font-mono tracking-wider text-slate-800 select-all">{secret.replace(/(.{4})/g, "$1 ").trim()}</span>
        </p>
      )}
      <form action={action} className="space-y-3">
        <input
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="numeric"
          placeholder="123 456"
          aria-label="Code"
          className={`${input} text-center font-mono text-xl tracking-widest`}
        />
        <ErrorText text={state.error} />
        <Submit className={primary}>Bestätigen</Submit>
      </form>
      <form action={cancelLogin} className="text-right text-sm">
        <button type="submit" className="text-slate-500 hover:text-slate-900">
          Abbrechen
        </button>
      </form>
    </div>
  );
}
