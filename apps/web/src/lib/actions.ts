import "server-only";
import { isAppError } from "@nexus/core";
import { createLogger } from "@nexus/core/logger";

const log = createLogger("web");

export type ActionResult<T = undefined> =
  { ok: true; data?: T; message?: string } | { ok: false; error: string };

/**
 * Wraps a server action body: known AppErrors become user-facing messages, everything else is
 * logged and replaced by a generic message (no internals leak to the browser).
 */
export async function runAction<T>(
  name: string,
  fn: () => Promise<{ data?: T; message?: string } | void>,
): Promise<ActionResult<T>> {
  try {
    const result = await fn();
    return { ok: true, ...(result ?? {}) };
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.message };
    // redirect() and notFound() work by throwing; let them through.
    if (error instanceof Error && "digest" in error) throw error;
    log.error({ err: error, action: name }, "server action failed");
    return { ok: false, error: "Das hat nicht geklappt. Bitte versuchen Sie es erneut." };
  }
}
