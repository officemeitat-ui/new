import { NextResponse, type NextRequest } from "next/server";
import { LEARNER_COOKIE, LEARNER_MAX_AGE } from "@/lib/awareness/session";
import { learnerByToken } from "@/lib/awareness/store";
import { signState } from "@/lib/session";

/** Persönlicher Zugangslink aus der Einladung: meldet die Person im Lernbereich an. */
export async function GET(request: NextRequest, { params }: RouteContext<"/lernen/start/[token]">) {
  const { token } = await params;
  const learner = await learnerByToken(token);
  if (!learner) return NextResponse.redirect(new URL("/lernen?ungueltig=1", request.url));
  const response = NextResponse.redirect(new URL("/lernen", request.url));
  response.cookies.set(LEARNER_COOKIE, await signState({ lid: learner.id }, LEARNER_MAX_AGE), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/lernen",
    maxAge: LEARNER_MAX_AGE,
  });
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
