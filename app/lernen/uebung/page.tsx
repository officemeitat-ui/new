import Link from "next/link";
import { completeExercise } from "@/app/lernen/actions";
import { Exercise } from "@/components/awareness/Exercise";
import { learnerContext } from "@/lib/awareness/view";

export default async function UebungPage() {
  const { course, fill } = await learnerContext();
  const scenarios = course.scenarios.map((s) => ({ ...s, situation: fill(s.situation), explanation: fill(s.explanation) }));
  return (
    <div className="space-y-4">
      <div>
        <Link href="/lernen" className="text-sm text-slate-500 hover:text-slate-900">
          ← Übersicht
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Übung: Echt oder Angriff?</h1>
        <p className="text-sm text-slate-500">Sechs Situationen aus dem Alltag. Wie würden Sie reagieren?</p>
      </div>
      <Exercise scenarios={scenarios}>
        <form action={completeExercise}>
          <input type="hidden" name="courseId" value={course.id} />
          <button type="submit" className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-700">
            Weiter zum Abschlussquiz
          </button>
        </form>
      </Exercise>
    </div>
  );
}
