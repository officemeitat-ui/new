import Link from "next/link";
import { leaveLearning } from "@/app/lernen/actions";
import { workspace } from "@/config/workspace";
import { KI_KOMPETENZ } from "@/lib/awareness/content";
import { currentLearner } from "@/lib/awareness/session";
import { EXERCISE_STEP, impulseFor } from "@/lib/awareness/store";
import { learnerContext } from "@/lib/awareness/view";

const date = (iso: string) => new Intl.DateTimeFormat("de-AT", { dateStyle: "long", timeZone: workspace.timeZone }).format(new Date(iso));

export default async function LernenStart({ searchParams }: PageProps<"/lernen">) {
  const { ungueltig } = await searchParams;
  if (!(await currentLearner())) {
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold">Willkommen</h1>
        {ungueltig ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Dieser Link ist nicht (mehr) gültig. Bitte bei Ihrer IT einen neuen anfordern.
          </p>
        ) : null}
        <p className="text-sm text-slate-600">
          Bitte öffnen Sie den persönlichen Link aus Ihrer Einladung. Er bringt Sie direkt zu Ihrer Schulung – ganz ohne Passwort.
        </p>
      </div>
    );
  }
  const { learner, course, done, status, fill } = await learnerContext();
  const impulse = impulseFor(new Date());
  const nextLesson = course.lessons.find((l) => !done.has(l.id));
  const next = nextLesson
    ? { href: `/lernen/kurs/${nextLesson.id}`, label: done.size ? "Weiterlernen" : "Schulung starten" }
    : !done.has(EXERCISE_STEP)
      ? { href: "/lernen/uebung", label: "Zur Übung „Echt oder Angriff?“" }
      : { href: "/lernen/quiz", label: status.best?.passed ? "Quiz wiederholen" : "Zum Abschlussquiz" };
  const percent = Math.round((status.stepsDone / status.stepsTotal) * 100);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Hallo {learner.name.split(" ")[0]}!</h1>
          <p className="text-sm text-slate-500">Ihre Schulung zu KI und Sicherheit – in kleinen Schritten, am Handy oder PC.</p>
        </div>
        <form action={leaveLearning}>
          <button type="submit" className="text-xs text-slate-400 hover:text-slate-700">
            Abmelden
          </button>
        </form>
      </div>

      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase">{KI_KOMPETENZ.legalBasis}</p>
        <h2 className="text-lg font-semibold">{course.title}</h2>
        <p className="text-sm text-slate-600">{course.summary}</p>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-slate-500">
          {status.stepsDone} von {status.stepsTotal} Schritten · ca. {course.minutes} Minuten insgesamt · bestanden ab {course.passPercent}{" "}
          %
        </p>
        {status.best?.passed && status.validUntil ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            ✓ Bestanden am {date(status.best.createdAt)} ({status.best.score}/{status.best.total}) – gültig bis {date(status.validUntil)}.{" "}
            <Link href={`/lernen/nachweis/${status.best.id}`} className="font-semibold underline">
              Teilnahmenachweis
            </Link>
          </p>
        ) : status.best ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Letzter Versuch: {status.best.score}/{status.best.total} – noch nicht bestanden. Sie können jederzeit wiederholen.
          </p>
        ) : null}
        <Link href={next.href} className="inline-block rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-700">
          {next.label}
        </Link>
        <ol className="space-y-1 pt-2 text-sm">
          {course.lessons.map((lesson, i) => (
            <li key={lesson.id}>
              <Link href={`/lernen/kurs/${lesson.id}`} className="flex items-center gap-2 hover:underline">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${done.has(lesson.id) ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600"}`}
                >
                  {done.has(lesson.id) ? "✓" : i + 1}
                </span>
                {lesson.title} <span className="text-xs text-slate-400">· {lesson.minutes} Min.</span>
              </Link>
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${done.has(EXERCISE_STEP) ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600"}`}
            >
              {done.has(EXERCISE_STEP) ? "✓" : course.lessons.length + 1}
            </span>
            <Link href="/lernen/uebung" className="hover:underline">
              Übung „Echt oder Angriff?“
            </Link>
          </li>
          <li className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${status.best?.passed ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600"}`}
            >
              {status.best?.passed ? "✓" : course.lessons.length + 2}
            </span>
            <Link href="/lernen/quiz" className="hover:underline">
              Abschlussquiz ({course.quiz.length} Fragen)
            </Link>
          </li>
        </ol>
      </section>

      <section className="space-y-2 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <p className="text-xs font-semibold tracking-wide text-sky-700 uppercase">Impuls des Monats</p>
        <h2 className="text-lg font-semibold">{impulse.title}</h2>
        <p className="text-sm whitespace-pre-line text-slate-700">{fill(impulse.text)}</p>
      </section>

      <Link href="/lernen/regeln" className="block rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
        <span className="text-lg font-bold tracking-wide">STOPP · PRÜFEN · BESTÄTIGEN</span>
        <span className="block text-sm text-slate-300">
          Die Regel für Zahlungen, Bankdaten, Passwörter und dringende Bitten – zum Nachlesen und Aushängen.
        </span>
      </Link>
    </div>
  );
}
