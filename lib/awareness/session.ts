import "server-only";
import { cookies, headers } from "next/headers";
import { getLearner, touchLearner, type Learner } from "@/lib/awareness/store";
import { readState } from "@/lib/session";

// Anmeldung der Lernenden: der persönliche Link setzt ein signiertes Cookie (nur Lernbereich, 180 Tage).
// Lernende sehen ausschließlich ihren eigenen Fortschritt – kein Zugang zum Arbeitsplatz.

export const LEARNER_COOKIE = "lernen";
export const LEARNER_MAX_AGE = 180 * 86_400;

export async function currentLearner(): Promise<Learner | null> {
  const state = await readState<{ lid: string }>((await cookies()).get(LEARNER_COOKIE)?.value);
  if (!state?.lid) return null;
  const learner = await getLearner(state.lid);
  if (!learner || learner.disabled) return null;
  if (!learner.lastSeenAt || Date.now() - new Date(learner.lastSeenAt).getTime() > 3_600_000) await touchLearner(learner.id);
  return learner;
}

/** Öffentliche Adresse für Einladungslinks (PUBLIC_URL, sonst aus der Anfrage). */
export async function publicBase(): Promise<string> {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
}

export const learnerLink = (base: string, token: string) => `${base}/lernen/start/${token}`;
