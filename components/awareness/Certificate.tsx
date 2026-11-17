import { workspace } from "@/config/workspace";
import type { AwarenessCourse } from "@/lib/awareness/content";
import { addMonths, type Attempt } from "@/lib/awareness/store";

const date = (iso: string) => new Intl.DateTimeFormat("de-AT", { dateStyle: "long", timeZone: workspace.timeZone }).format(new Date(iso));

/** Teilnahmenachweis zum Ausdrucken bzw. als PDF speichern (Browser: Drucken → Als PDF speichern). */
export function Certificate({ name, org, course, attempt }: { name: string; org: string; course: AwarenessCourse; attempt: Attempt }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end print:hidden">
        <button type="button" data-print className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
          Drucken / als PDF speichern
        </button>
      </div>
      <article className="mx-auto max-w-2xl space-y-6 rounded-2xl bg-white p-6 shadow-sm sm:p-10 ring-1 ring-slate-200 print:rounded-none print:shadow-none print:ring-0">
        <header className="border-b border-slate-200 pb-4">
          <p className="text-sm font-semibold tracking-widest text-emerald-700 uppercase">Teilnahmenachweis</p>
          <h1 className="mt-1 text-2xl font-bold">{course.title}</h1>
          <p className="text-sm text-slate-500">Schulung gemäß {course.legalBasis}</p>
        </header>
        <p className="text-lg">
          <strong>{name}</strong>
          {org ? <> ({org})</> : null} hat die Schulung am <strong>{date(attempt.createdAt)}</strong> abgeschlossen und das Abschlussquiz
          mit{" "}
          <strong>
            {attempt.score} von {attempt.total}
          </strong>{" "}
          richtigen Antworten bestanden.
        </p>
        <section>
          <h2 className="text-sm font-semibold text-slate-500">Inhalte</h2>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {course.lessons.map((lesson) => (
              <li key={lesson.id}>{lesson.title}</li>
            ))}
            <li>Übung „Echt oder Angriff?“ ({course.scenarios.length} Situationen)</li>
          </ul>
        </section>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Gültig bis</dt>
          <dd>{date(addMonths(attempt.createdAt, course.repeatMonths))} (Auffrischung jährlich)</dd>
          <dt className="text-slate-500">Nachweis-Nr.</dt>
          <dd className="font-mono">{attempt.id.slice(0, 8).toUpperCase()}</dd>
          <dt className="text-slate-500">Ausgestellt von</dt>
          <dd>{workspace.company}</dd>
        </dl>
      </article>
    </div>
  );
}
