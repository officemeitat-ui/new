import { disconnectMicrosoft, endOtherSessions, endSession } from "@/app/app/einstellungen/actions";
import { DemoData, PasswordChangeForm, RecoveryCodesForm } from "@/components/workspace/SettingsUI";
import { demoLoaded } from "@/lib/demo";
import { workspace } from "@/config/workspace";
import { currentSession, requireAdmin } from "@/lib/auth";
import { microsoftLoginConfigured } from "@/lib/entra";
import { listSessions, microsoftRefreshToken, remainingRecoveryCodes, ROLE_LABELS } from "@/lib/users";

const METHOD = { "passwort+code": "Passwort + Einmalcode", microsoft: "Microsoft", wiederherstellung: "Wiederherstellungscode" };

/** „Chrome auf Windows“ statt der ganzen Browser-Kennung. */
function device(userAgent: string | null): string {
  if (!userAgent) return "unbekanntes Gerät";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const system = /iPhone|iPad/.test(userAgent)
    ? "iPhone/iPad"
    : /Android/.test(userAgent)
      ? "Android"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X/.test(userAgent)
          ? "Mac"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return system ? `${browser} auf ${system}` : browser;
}

const when = (iso: string) =>
  new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short", timeZone: workspace.timeZone }).format(new Date(iso));

export default async function KontoPage() {
  const user = await requireAdmin();
  const [current, sessions, codesLeft, msToken] = await Promise.all([
    currentSession(),
    listSessions(user.id),
    remainingRecoveryCodes(user.id),
    microsoftRefreshToken(user.id),
  ]);
  const microsoft = microsoftLoginConfigured();
  const card = "space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200";

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="font-semibold">Konto</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">Name</dt>
          <dd>{user.name}</dd>
          <dt className="text-slate-500">E-Mail</dt>
          <dd>{user.email}</dd>
          <dt className="text-slate-500">Rolle</dt>
          <dd>{ROLE_LABELS[user.role]}</dd>
        </dl>
      </section>

      <section className={card}>
        <h2 className="font-semibold">Anmeldung mit Microsoft</h2>
        {!microsoft ? (
          <p className="text-sm text-slate-500">Noch nicht eingerichtet (App-Registrierung in Entra ID, siehe README).</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              {user.entraLinked ? "Verknüpft ✓ – MFA und Regeln setzt Microsoft durch (Conditional Access)." : "Noch nicht verknüpft."}{" "}
              {msToken
                ? "Zugriff auf OneDrive/SharePoint ist aktiv (mit deinen eigenen Rechten)."
                : "Kein Zugriff auf OneDrive/SharePoint."}
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href="/api/auth/microsoft?weiter=/app/einstellungen"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
              >
                {user.entraLinked ? "Erneut mit Microsoft anmelden" : "Mit Microsoft verknüpfen"}
              </a>
              {msToken && (
                <form action={disconnectMicrosoft}>
                  <button type="submit" className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:text-red-700">
                    OneDrive-Zugriff trennen
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </section>

      <section className={card}>
        <h2 className="font-semibold">Passwort & Einmalcode</h2>
        <p className="text-sm text-slate-600">
          {user.totpEnabled
            ? `Einmalcode (Authenticator-App) ist aktiv · ${codesLeft} Wiederherstellungscodes übrig.`
            : user.hasPassword
              ? "Einmalcode wird bei der nächsten Anmeldung mit Passwort eingerichtet."
              : "Dieses Konto meldet sich nur mit Microsoft an."}
        </p>
        <PasswordChangeForm hasPassword={user.hasPassword} />
        {user.totpEnabled && <RecoveryCodesForm />}
      </section>

      {user.role === "inhaber" && (
        <section className={card}>
          <h2 className="font-semibold">Demo-Daten</h2>
          <p className="text-sm text-slate-600">
            Drei Beispielkunden mit Tickets, vollständiger Kundenakte, Netzplan, Fristen, Checklisten, Stunden und Schulungen – zum
            Ausprobieren und Vorführen. Alles ist als „(Demo)“ gekennzeichnet und lässt sich wieder entfernen.
          </p>
          <DemoData loaded={await demoLoaded()} />
        </section>
      )}

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Angemeldete Geräte</h2>
          {sessions.length > 1 && (
            <form action={endOtherSessions}>
              <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
                Alle anderen abmelden
              </button>
            </form>
          )}
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="font-medium">{device(s.userAgent)}</span>
                {s.id === current?.session.id && (
                  <span className="ml-2 rounded-full bg-emerald-100 px-2 text-xs text-emerald-800">dieses Gerät</span>
                )}
                <span className="block text-xs text-slate-500">
                  {METHOD[s.method]} · seit {when(s.createdAt)} · zuletzt {when(s.lastSeenAt)}
                  {s.ip ? ` · ${s.ip}` : ""}
                </span>
              </span>
              {s.id !== current?.session.id && (
                <form action={endSession}>
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="text-xs text-slate-500 hover:text-red-700">
                    Abmelden
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
