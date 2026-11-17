import { AddUserForm, UserActions } from "@/components/workspace/SettingsUI";
import { workspace } from "@/config/workspace";
import { requireOwner } from "@/lib/auth";
import { microsoftLoginConfigured } from "@/lib/entra";
import { listUsers, ROLE_LABELS } from "@/lib/users";

export default async function BenutzerPage() {
  const me = await requireOwner();
  const users = await listUsers();
  const when = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short", timeZone: workspace.timeZone }).format(new Date(iso))
      : "noch nie";
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold">Benutzer anlegen</h2>
        <p className="text-sm text-slate-600">
          Mit Microsoft-Anmeldung reicht die Microsoft-365-Adresse – MFA erzwingt Entra ID. Mit Passwort richtet die Person beim ersten Mal
          einen Einmalcode ein.
        </p>
        <AddUserForm microsoft={microsoftLoginConfigured()} />
      </section>
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className={`space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${u.disabled ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="font-semibold">{u.name}</span> <span className="text-sm text-slate-500">{u.email}</span>
                {u.disabled && <span className="ml-2 rounded-full bg-red-100 px-2 text-xs text-red-800">gesperrt</span>}
              </span>
              <span className="text-xs text-slate-500">zuletzt angemeldet: {when(u.lastLoginAt)}</span>
            </div>
            <p className="text-xs text-slate-600">
              {ROLE_LABELS[u.role]} · {u.entraLinked ? "Microsoft verknüpft" : "Microsoft nicht verknüpft"} ·{" "}
              {u.totpEnabled ? "Einmalcode aktiv" : u.hasPassword ? "Einmalcode noch nicht eingerichtet" : "nur Microsoft"}
            </p>
            <UserActions id={u.id} role={u.role} disabled={u.disabled} self={u.id === me.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}
