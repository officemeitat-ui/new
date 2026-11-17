import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Schneller Weiterleitungs-Check (nur Signatur und Ablauf des Cookies). Die eigentliche Absicherung – Sitzung nicht
// widerrufen, Konto aktiv, Rolle – passiert in jeder Seite und Server Action (requireAdmin / requireOwner).
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/admin/login") return NextResponse.next();
  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const login = new URL("/admin/login", request.url);
  // Nach der Anmeldung zurück zur aufgerufenen Seite (die Anmeldung lässt nur /app und /admin als Ziel zu).
  if (request.nextUrl.pathname !== "/admin") login.searchParams.set("weiter", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin/:path*", "/app/:path*"],
};
