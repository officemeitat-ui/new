"use client";

import { useActionState } from "react";
import { sendQuiz } from "@/app/lernen/actions";

type Question = { id: string; question: string; options: string[] };

/** Abschlussquiz – die Lösungen kennt nur der Server, hier gehen nur Fragen und Antworten durch. */
export function QuizForm({ courseId, questions }: { courseId: string; questions: Question[] }) {
  const [state, action, pending] = useActionState(sendQuiz, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="courseId" value={courseId} />
      {questions.map((q, i) => (
        <fieldset key={q.id} className="space-y-2 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <legend className="sr-only">Frage {i + 1}</legend>
          <p className="font-medium">
            <span className="text-slate-400">{i + 1}.</span> {q.question}
          </p>
          {q.options.map((option, j) => (
            <label
              key={j}
              className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200 has-[:checked]:bg-emerald-50 has-[:checked]:ring-emerald-500"
            >
              <input type="radio" name={q.id} value={j} required className="mt-0.5" />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ))}
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Wird ausgewertet …" : "Auswerten"}
      </button>
    </form>
  );
}
