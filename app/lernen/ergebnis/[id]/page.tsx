import Link from "next/link";
import { notFound } from "next/navigation";
import { getAttempt } from "@/lib/awareness/store";
import { learnerContext } from "@/lib/awareness/view";

export default async function ErgebnisPage({ params }: PageProps<"/lernen/ergebnis/[id]">) {
  const { id } = await params;
  const { learner, course, fill } = await learnerContext();
  const attempt = await getAttempt(id);
  if (!attempt || attempt.learnerId !== learner.id) notFound();
  return (
    <div className="space-y-4">
      <div
        className={`rounded-2xl p-5 shadow-sm ring-1 ${attempt.passed ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200"}`}
      >
        <h1 className="text-2xl font-bold">{attempt.passed ? "Bestanden – gratuliere!" : "Noch nicht ganz"}</h1>
        <p className="mt-1">
          {attempt.score} von {attempt.total} richtig.{" "}
          {attempt.passed
            ? "Ihr Teilnahmenachweis ist fertig."
            : `Bestanden ab ${Math.ceil((course.passPercent / 100) * attempt.total)} – lesen Sie die Erklärungen und versuchen Sie es noch einmal.`}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {attempt.passed ? (
            <Link href={`/lernen/nachweis/${attempt.id}`} className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white">
              Teilnahmenachweis öffnen
            </Link>
          ) : (
            <Link href="/lernen/quiz" className="rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white">
              Noch einmal
            </Link>
          )}
          <Link href="/lernen" className="rounded-xl bg-white px-5 py-2.5 font-semibold ring-1 ring-slate-300">
            Zur Übersicht
          </Link>
        </div>
      </div>
      <ol className="space-y-3">
        {course.quiz.map((q, i) => {
          const right = attempt.answers[i] === q.correct;
          return (
            <li key={q.id} className="space-y-1 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
              <p className="font-medium">
                <span className={right ? "text-emerald-600" : "text-red-600"}>{right ? "✓" : "✗"}</span> {i + 1}. {fill(q.question)}
              </p>
              {!right && <p className="text-red-700">Ihre Antwort: {fill(q.options[attempt.answers[i]] ?? "–")}</p>}
              <p className="text-emerald-800">Richtig: {fill(q.options[q.correct])}</p>
              <p className="text-slate-600">{fill(q.explanation)}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
