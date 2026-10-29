import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Schneller Weiterleitungs-Check für den Admin-Bereich. Die eigentliche Absicherung
// passiert zusätzlich in jeder Admin-Seite und Server Action (requireAdmin).
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/admin/login") return NextResponse.next();
  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  return NextResponse.redirect(new URL("/admin/login", request.url));
}

export const config = {
  matcher: ["/admin/:path*"],
};
