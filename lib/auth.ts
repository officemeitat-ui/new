import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { readSessionToken, SESSION_COOKIE } from "@/lib/session";
import { audit, sessionUser, type Session, type User } from "@/lib/users";

export type { User } from "@/lib/users";

/** Die angemeldete Person samt Sitzung – oder null. Einmal je Anfrage aus der Datenbank. */
export const currentSession = cache(async (): Promise<{ user: User; session: Session } | null> => {
  const token = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!token) return null;
  return sessionUser(token.sessionId);
});

export async function currentUser(): Promise<User | null> {
  return (await currentSession())?.user ?? null;
}

/** Für Route Handler: angemeldet (beliebige Rolle)? */
export async function isAdmin(): Promise<boolean> {
  return (await currentSession()) !== null;
}

/** In jeder geschützten Seite und Server Action aufrufen – proxy.ts allein reicht nicht. Liefert die angemeldete Person. */
export async function requireAdmin(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  return user;
}

/** Nur Inhaber/in: Büro (E-Mails, Belege), Cockpit, Benutzerverwaltung, Protokoll. */
export async function requireOwner(): Promise<User> {
  const user = await requireAdmin();
  if (user.role !== "inhaber") redirect("/app?kein_zugriff=1");
  return user;
}

export async function isOwner(): Promise<boolean> {
  return (await currentUser())?.role === "inhaber";
}

/** IP-Adresse und Browser der Anfrage (hinter Caddy aus X-Forwarded-For). */
export async function clientInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: forwarded || h.get("x-real-ip") || null, userAgent: h.get("user-agent") };
}

/** Protokolliert eine Aktion der angemeldeten Person. Fehler beim Protokollieren brechen die Aktion nicht ab. */
export async function logAction(action: string, detail: string | null = null): Promise<void> {
  try {
    const [user, client] = await Promise.all([currentUser(), clientInfo()]);
    await audit(action, detail, { userId: user?.id, userName: user?.name, ip: client.ip });
  } catch (error) {
    console.error("Protokoll fehlgeschlagen:", error);
  }
}
