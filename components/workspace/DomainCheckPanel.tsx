import { checkDomainNow } from "@/app/app/record-actions";
import { workspace } from "@/config/workspace";
import { GRADE_STYLE, type DomainCheck } from "@/lib/checks/domain";
import { isCheckError } from "@/lib/checks/run";

const LEVEL = {
  fehler: "bg-red-50 text-red-800 ring-red-200",
  warnung: "bg-amber-50 text-amber-900 ring-amber-200",
  info: "bg-sky-50 text-sky-900 ring-sky-200",
};

/** Ergebnis der Domain-Prüfung mit Note, Befunden und Rohdaten. */
export function DomainCheckPanel({ recordId, result, checkedAt }: { recordId: string; result: unknown; checkedAt: string | null }) {
  const when = checkedAt
    ? new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short", timeZone: workspace.timeZone }).format(new Date(checkedAt))
    : null;
  const check = result && !isCheckError(result) ? (result as DomainCheck) : null;
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">E-Mail-Sicherheit & Zertifikat</h2>
        <form action={checkDomainNow}>
          <input type="hidden" name="id" value={recordId} />
          <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
            Jetzt prüfen
          </button>
        </form>
      </div>
      {!result && <p className="text-sm text-slate-500">Noch nicht geprüft – die Prüfung läuft täglich automatisch.</p>}
      {isCheckError(result) && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Prüfung fehlgeschlagen: {result.error}</p>
      )}
      {check?.refreshError && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Letzte Wiederholung fehlgeschlagen ({check.refreshError}) – angezeigt wird das Ergebnis der vorherigen Prüfung.
        </p>
      )}
      {check && (
        <>
          <div className="flex items-center gap-3">
            <span className={`flex h-12 w-12 items-center justify-center rounded-xl text-2xl font-black ${GRADE_STYLE[check.grade]}`}>
              {check.grade}
            </span>
            <p className="text-sm text-slate-600">
              {check.findings.filter((f) => f.level === "fehler").length} Fehler ·{" "}
              {check.findings.filter((f) => f.level === "warnung").length} Hinweise
              {when ? ` · geprüft ${when}` : ""}
            </p>
          </div>
          <ul className="space-y-2">
            {check.findings.map((f, i) => (
              <li key={i} className={`rounded-lg px-3 py-2 text-sm ring-1 ${LEVEL[f.level]}`}>
                {f.text}
                {f.hint && <span className="block text-xs opacity-80">→ {f.hint}</span>}
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-500">Mail</dt>
            <dd>{check.mx.provider ? `${check.mx.provider} (${check.mx.hosts.join(", ")})` : "keine MX-Einträge"}</dd>
            <dt className="text-slate-500">SPF</dt>
            <dd className="font-mono break-all">{check.spf ?? "–"}</dd>
            <dt className="text-slate-500">DMARC</dt>
            <dd className="font-mono break-all">{check.dmarc ?? "–"}</dd>
            <dt className="text-slate-500">DKIM</dt>
            <dd>{check.dkim.length ? check.dkim.join(", ") : "–"}</dd>
            <dt className="text-slate-500">Zertifikat</dt>
            <dd>
              {check.tls
                ? `${check.tls.host}: gültig bis ${new Intl.DateTimeFormat("de-AT", { dateStyle: "medium" }).format(new Date(check.tls.validTo))} (${check.tls.daysLeft} Tage) · ${check.tls.issuer ?? ""}`
                : (check.tlsError ?? "–")}
            </dd>
          </dl>
        </>
      )}
    </section>
  );
}
