import { NextResponse, type NextRequest } from "next/server";
import { clientInfo } from "@/lib/auth";
import { MicrosoftLoginError, redeemCode } from "@/lib/entra";
import { startSession } from "@/lib/login";
import { readState } from "@/lib/session";
import { audit, saveMicrosoftToken, userForMicrosoft } from "@/lib/users";

type State = { state: string; nonce: string; verifier: string; next: string };

/** Rückkehr von Microsoft: Code einlösen, Konto zuordnen, Sitzung anlegen. Nur vorab angelegte Konten kommen hinein. */
export async function GET(request: NextRequest) {
  const fail = (code: string) => {
    const response = NextResponse.redirect(new URL(`/admin/login?fehler=${code}`, request.url));
    response.cookies.delete({ name: "ms_anmeldung", path: "/api/auth/microsoft" });
    return response;
  };
  const params = request.nextUrl.searchParams;
  const saved = await readState<State>(request.cookies.get("ms_anmeldung")?.value);
  if (!saved || !params.get("state") || params.get("state") !== saved.state) return fail("microsoft-abgelaufen");
  if (params.get("error")) return fail("microsoft-abgebrochen");
  const code = params.get("code");
  if (!code) return fail("microsoft-abgebrochen");

  const client = await clientInfo();
  try {
    const { identity, tokens } = await redeemCode(code, saved.verifier, saved.nonce);
    const user = await userForMicrosoft(identity.oid, identity.email);
    if (!user || user.disabled) {
      await audit("Anmeldung abgelehnt", `Microsoft-Konto ohne Zugang: ${identity.email ?? identity.oid}`, { ip: client.ip });
      return fail("microsoft-unbekannt");
    }
    if (tokens.refreshToken) await saveMicrosoftToken(user.id, tokens.refreshToken, tokens.scope);
    await startSession(user, "microsoft");
  } catch (error) {
    console.error("Microsoft-Anmeldung fehlgeschlagen:", error);
    await audit("Anmeldung fehlgeschlagen", error instanceof MicrosoftLoginError ? error.message : "Microsoft", { ip: client.ip });
    return fail("microsoft-fehler");
  }
  const response = NextResponse.redirect(new URL(saved.next, request.url));
  response.cookies.delete({ name: "ms_anmeldung", path: "/api/auth/microsoft" });
  return response;
}
