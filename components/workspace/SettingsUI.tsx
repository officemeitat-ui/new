"use client";

import { useActionState, useEffect, useRef } from "react";
import { addUser, changeOwnPassword, manageUser, newRecoveryCodes, type SettingsState } from "@/app/app/einstellungen/actions";
import { Submit } from "@/components/workspace/Forms";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base md:text-sm focus:border-brand focus:outline-none";
const secondary = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60";

function Feedback({ state }: { state: SettingsState }) {
  if (state.error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
  return null;
}

function useReset(state: SettingsState) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return form;
}

export function PasswordChangeForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action] = useActionState(changeOwnPassword, {});
  const form = useReset(state);
  return (
    <form ref={form} action={action} className="grid gap-2 sm:grid-cols-3">
      {hasPassword && (
        <input
          name="current"
          type="password"
          required
          autoComplete="current-password"
          placeholder="bisheriges Passwort"
          className={input}
        />
      )}
      <input
        name="password"
        type="password"
        required
        minLength={12}
        autoComplete="new-password"
        placeholder="neues Passwort"
        className={input}
      />
      <input
        name="confirm"
        type="password"
        required
        minLength={12}
        autoComplete="new-password"
        placeholder="wiederholen"
        className={input}
      />
      <div className="sm:col-span-3">
        <Submit>{hasPassword ? "Passwort ändern" : "Passwort festlegen"}</Submit>
      </div>
      <div className="sm:col-span-3">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function RecoveryCodesForm() {
  const [state, action] = useActionState(newRecoveryCodes, {});
  if (state.codes) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">Neue Wiederherstellungscodes – nur jetzt sichtbar, die alten gelten nicht mehr:</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 font-mono text-sm ring-1 ring-slate-200 sm:grid-cols-4">
          {state.codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input
        name="code"
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="aktueller Code"
        aria-label="Aktueller Code"
        className={`${input} max-w-40 font-mono`}
      />
      <Submit className={secondary}>Neue Wiederherstellungscodes</Submit>
      <div className="w-full">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function AddUserForm({ microsoft }: { microsoft: boolean }) {
  const [state, action] = useActionState(addUser, {});
  const form = useReset(state);
  return (
    <form ref={form} action={action} className="grid gap-2 sm:grid-cols-2">
      <input name="name" required placeholder="Name" className={input} />
      <input name="email" type="email" required placeholder="E-Mail (Microsoft-365-Adresse)" className={input} />
      <select name="role" defaultValue="technik" className={input} aria-label="Rolle">
        <option value="technik">Technik – Arbeitsplatz, Doku, Awareness</option>
        <option value="inhaber">Inhaber/in – zusätzlich Büro, Cockpit, Benutzer</option>
      </select>
      <input
        name="password"
        type="password"
        minLength={12}
        autoComplete="new-password"
        placeholder={microsoft ? "Startpasswort (leer = nur Microsoft-Anmeldung)" : "Startpasswort (mind. 12 Zeichen)"}
        required={!microsoft}
        className={input}
      />
      <div className="sm:col-span-2">
        <Submit>Benutzer anlegen</Submit>
      </div>
      <div className="sm:col-span-2">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function UserActions({ id, role, disabled, self }: { id: string; role: string; disabled: boolean; self: boolean }) {
  const [state, action] = useActionState(manageUser, {});
  const button = (value: string, label: string, confirmText?: string) => (
    <button
      type="submit"
      name="action"
      value={value}
      className={secondary}
      onClick={(event) => {
        if (confirmText && !window.confirm(confirmText)) event.preventDefault();
      }}
    >
      {label}
    </button>
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <select name="role" defaultValue={role} className={`${input} max-w-36`} aria-label="Rolle">
        <option value="technik">Technik</option>
        <option value="inhaber">Inhaber/in</option>
      </select>
      {button("rolle", "Rolle speichern")}
      {!self &&
        (disabled ? button("entsperren", "Entsperren") : button("sperren", "Sperren", "Konto sperren? Alle Sitzungen werden beendet."))}
      {button(
        "faktor",
        "Einmalcode zurücksetzen",
        "Zweiten Faktor zurücksetzen? Die Person richtet ihn bei der nächsten Anmeldung neu ein.",
      )}
      {button("abmelden", "Überall abmelden")}
      <div className="w-full">
        <Feedback state={state} />
      </div>
    </form>
  );
}
