import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/** Pages and endpoints reachable without a session (/m/<token>: QR defect reports). */
const PUBLIC = /^\/(login|invite|no-access|m|api\/auth|api\/health)(\/|$)/;

/**
 * Content Security Policy with a fresh nonce per request (Next.js guide "Content Security
 * Policy"): scripts only from this origin or with the nonce, no plugins, no framing, forms and
 * connections only to this origin. Inline styles stay allowed – the brand palette and a few
 * computed sizes use them; they cannot run code.
 */
function contentSecurityPolicy(nonce: string, https: boolean): string {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * Sets the CSP on every page and does the optimistic session check: without a session cookie,
 * app pages redirect to the login. The real verification happens in the data access layer
 * (src/lib/session.ts).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, request.nextUrl.protocol === "https:");
  const { pathname, search } = request.nextUrl;

  if (!PUBLIC.test(pathname) && !getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    const next = pathname + search;
    if (next !== "/") url.searchParams.set("next", next);
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except static assets; prefetches get their CSP with the real navigation.
      source:
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
