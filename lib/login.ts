import "server-only";
import { cookies } from "next/headers";
import { clientInfo } from "@/lib/auth";
import { createSessionToken, readState, SESSION_COOKIE, SESSION_MAX_AGE, signState } from "@/lib/session";
import { audit, createSession, type SessionMethod, type User } from "@/lib/users";

// Hilfen für die Anmeldung – bewusst NICHT in einer „use server“-Datei, damit sie nicht als Server Action aufrufbar sind.

export const LOGIN_STEP_COOKIE = "anmeldung";
export type LoginStep = { uid: string; step: "mfa" | "mfa-setup"; next: string };

/** Nur Ziele im eigenen Arbeitsplatz/Cockpit zulassen (keine offenen Weiterleitungen). */
export function safeNext(value: unknown): string {
  const next = String(value ?? "");
  return /^\/(app|admin)(\/[\w\-./%?=&]*)?$/.test(next) && !next.includes("..") ? next : "/app";
}

export async function setLoginStep(step: LoginStep) {
  (await cookies()).set(LOGIN_STEP_COOKIE, await signState(step, 10 * 60), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin/login",
    maxAge: 10 * 60,
  });
}

export async function readLoginStep(): Promise<LoginStep | null> {
  return readState<LoginStep>((await cookies()).get(LOGIN_STEP_COOKIE)?.value);
}

export async function clearLoginStep() {
  (await cookies()).delete({ name: LOGIN_STEP_COOKIE, path: "/admin/login" });
}

/** Legt die Sitzung an und setzt das Sitzungs-Cookie. Nur nach vollständiger Anmeldung aufrufen. */
export async function startSession(user: User, method: SessionMethod) {
  const client = await clientInfo();
  const session = await createSession(user.id, method, client);
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(session.id, session.expiresAt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  await audit("Anmeldung", method, { userId: user.id, userName: user.name, ip: client.ip });
}
