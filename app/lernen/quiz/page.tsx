import Link from "next/link";
import { QuizForm } from "@/components/awareness/QuizForm";
import { learnerContext } from "@/lib/awareness/view";

export default async function QuizPage() {
  const { course, fill } = await learnerContext();
  // Nur Fragen und Antwortmöglichkeiten an den Browser – ohne Lösungen und Erklärungen.
  const questions = course.quiz.map((q) => ({ id: q.id, question: fill(q.question), options: q.options.map(fill) }));
  const needed = Math.ceil((course.passPercent / 100) * course.quiz.length);
  return (
    <div className="space-y-4">
      <div>
        <Link href="/lernen" className="text-sm text-slate-500 hover:text-slate-900">
          ← Übersicht
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Abschlussquiz</h1>
        <p className="text-sm text-slate-500">
          {course.quiz.length} Fragen, je eine Antwort ist richtig. Bestanden ab {needed} richtigen Antworten – wiederholen geht jederzeit.
        </p>
      </div>
      <QuizForm courseId={course.id} questions={questions} />
    </div>
  );
}
