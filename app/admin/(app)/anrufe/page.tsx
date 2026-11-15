import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listCalls } from "@/lib/calls";
import { formatDateTime } from "@/lib/format";

function duration(seconds: number | null) {
  return seconds === null ? "–" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default async function CallsPage() {
  await requireAdmin();
  const calls = await listCalls();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Anrufe</h1>
        <p className="text-sm text-slate-500">Alle Gespräche des Telefon-Assistenten mit Zusammenfassung und Transkript.</p>
      </div>
      {calls.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          Noch keine Anrufe. Einrichtung unter{" "}
          <Link href="/admin/telefon" className="font-medium text-brand hover:underline">
            Telefon-Assistent
          </Link>
          .
        </p>
      ) : (
        <div className="space-y-3">
          {calls.map((call) => (
            <article key={call.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <header className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold">
                  {call.leadId ? (
                    <Link href={`/admin/leads/${call.leadId}`} className="hover:text-brand">
                      {call.phone ?? "Unbekannte Nummer"}
                    </Link>
                  ) : (
                    (call.phone ?? "Unbekannte Nummer")
                  )}
                </span>
                <span className="text-slate-500">
                  {formatDateTime(call.startedAt ?? call.createdAt)} · {duration(call.durationSeconds)} Min.
                  {call.cost !== null && ` · ${call.cost.toFixed(2)} $`}
                </span>
              </header>
              <p className="mt-2 text-sm text-slate-700">{call.summary ?? "Keine Zusammenfassung"}</p>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                {call.transcript && (
                  <details className="w-full">
                    <summary className="cursor-pointer text-slate-500">Transkript</summary>
                    <p className="mt-2 rounded-lg bg-slate-50 p-3 whitespace-pre-wrap text-slate-700">{call.transcript}</p>
                  </details>
                )}
                {call.recordingUrl && (
                  <a href={call.recordingUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
                    Aufnahme anhören
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
