import "server-only";
import { checkDomain, type DomainCheck } from "@/lib/checks/domain";
import { checkResults, checkTargets, saveCheckResult } from "@/lib/workspace/records";

export type StoredCheck = DomainCheck | { error: string; checkedAt: string };
export const isCheckError = (value: unknown): value is { error: string; checkedAt: string } =>
  Boolean(value && typeof value === "object" && "error" in value);

/** Prüft alle (oder ausgewählte) Domains und speichert das Ergebnis – jeweils vier gleichzeitig. */
export async function runDomainChecks(only?: string[]): Promise<{ checked: number; failed: number }> {
  const targets = (await checkTargets()).filter((t) => !only || only.includes(t.id));
  let checked = 0;
  let failed = 0;
  const queue = [...targets];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let target = queue.shift(); target; target = queue.shift()) {
        try {
          await saveCheckResult(target.id, await checkDomain(target.target));
          checked++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Ein vorübergehender Fehler (DNS-Ausfall) soll das letzte gültige Ergebnis nicht überschreiben.
          const previous = (await checkResults()).find((c) => c.id === target.id)?.result;
          if (previous && !isCheckError(previous)) {
            const last = previous as DomainCheck;
            await saveCheckResult(target.id, { ...last, refreshError: message }, new Date(last.checkedAt));
          } else {
            await saveCheckResult(target.id, { error: message, checkedAt: new Date().toISOString() });
          }
          failed++;
        }
      }
    }),
  );
  return { checked, failed };
}
