import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { CodeForm, FirstSetupForm, MfaSetup, PasswordForm } from "@/components/auth/LoginForms";
import { site } from "@/config/site";
import { workspace } from "@/config/workspace";
import { currentSession } from "@/lib/auth";
import { microsoftLoginConfigured } from "@/lib/entra";
import { readLoginStep, safeNext } from "@/lib/login";
import { otpauthUri } from "@/lib/totp";
import { countUsers, getUser, pendingTotpSecret } from "@/lib/users";

export const metadata: Metadata = { title: "Anmelden", robots: { index: false } };

const ERRORS: Record<string, string> = {
  "microsoft-aus": "Die Anmeldung mit Microsoft ist noch nicht eingerichtet.",
  "microsoft-abgelaufen": "Die Microsoft-Anmeldung ist abgelaufen – bitte noch einmal.",
  "microsoft-abgebrochen": "Die Microsoft-Anmeldung wurde abgebrochen.",
  "microsoft-unbekannt":
    "Dieses Microsoft-Konto hat keinen Zugang. Die Inhaberin bzw. der Inhaber muss es zuerst unter Einstellungen → Benutzer anlegen.",
  "microsoft-fehler": "Die Anmeldung mit Microsoft hat nicht geklappt. Bitte erneut versuchen.",
};

const MicrosoftLogo = () => (
  <svg viewBox="0 0 21 21" className="h-5 w-5" aria-hidden>
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);

export default async function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  const { fehler, weiter } = await searchParams;
  const next = safeNext(weiter);
  const step = await readLoginStep();
  if (!step && (await currentSession())) redirect(next);
  const users = await countUsers();
  const microsoft = microsoftLoginConfigured();

  let content: React.ReactNode;
  if (users === 0) {
    content = process.env.ADMIN_PASSWORD ? (
      <FirstSetupForm />
    ) : (
      <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
        Für die Ersteinrichtung muss <code>ADMIN_PASSWORD</code> in der Server-Konfiguration gesetzt sein.
      </p>
    );
  } else if (step) {
    const user = await getUser(step.uid);
    if (!user || user.disabled) {
      content = <p className="mt-6 text-sm text-red-700">Dieses Konto ist gesperrt.</p>;
    } else if (step.step === "mfa") {
      content = <CodeForm name={user.name.split(" ")[0]} />;
    } else {
      const secret = await pendingTotpSecret(user.id);
      const qrSvg = secret
        ? await QRCode.toString(otpauthUri(secret, user.email, workspace.company || site.brand.name), { type: "svg", margin: 1 })
        : null;
      content = <MfaSetup name={user.name.split(" ")[0]} qrSvg={qrSvg} secret={secret} />;
    }
  } else {
    content = (
      <div className="mt-6 space-y-4">
        {typeof fehler === "string" && ERRORS[fehler] && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{ERRORS[fehler]}</p>
        )}
        {microsoft && (
          <>
            <a
              href={`/api/auth/microsoft?weiter=${encodeURIComponent(next)}`}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white py-2.5 font-semibold text-slate-800 hover:bg-slate-50"
            >
              <MicrosoftLogo /> Mit Microsoft anmelden
            </a>
            <p className="text-center text-xs text-slate-400">oder mit Passwort und Einmalcode</p>
          </>
        )}
        <PasswordForm next={next} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <p className="text-lg font-bold">
          <span className="text-brand">●</span> {site.brand.name}
        </p>
        <h1 className="mt-1 text-sm text-slate-500">
          {users === 0 ? "Ersteinrichtung" : step?.step === "mfa-setup" ? "Zweiten Faktor einrichten" : "Anmelden"}
        </h1>
        {content}
      </div>
    </div>
  );
}
