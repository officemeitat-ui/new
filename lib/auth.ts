import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function passwordMatches(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** In jeder Admin-Seite und Server Action aufrufen – proxy.ts allein reicht nicht. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}
