import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/** Vergleicht zwei Geheimnisse in konstanter Zeit, unabhängig von ihrer Länge. */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
