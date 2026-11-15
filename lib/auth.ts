import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { secretsMatch } from "@/lib/secrets";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function passwordMatches(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return expected ? secretsMatch(input, expected) : false;
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** In jeder Admin-Seite und Server Action aufrufen – proxy.ts allein reicht nicht. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}
