import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, microsoftLoginConfigured, randomToken } from "@/lib/entra";
import { safeNext } from "@/lib/login";
import { signState } from "@/lib/session";

/** Startet die Anmeldung mit Microsoft: Zufallswerte (state, nonce, PKCE) im signierten Cookie, dann weiter zu Microsoft. */
export async function GET(request: NextRequest) {
  if (!microsoftLoginConfigured()) return NextResponse.redirect(new URL("/admin/login?fehler=microsoft-aus", request.url));
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const next = safeNext(request.nextUrl.searchParams.get("weiter"));
  const response = NextResponse.redirect(authorizeUrl({ state, nonce, verifier }));
  response.cookies.set("ms_anmeldung", await signState({ state, nonce, verifier, next }, 10 * 60), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/microsoft",
    maxAge: 10 * 60,
  });
  return response;
}
