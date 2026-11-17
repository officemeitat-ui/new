import Link from "next/link";
import { notFound } from "next/navigation";
import { completeLesson } from "@/app/lernen/actions";
import { learnerContext } from "@/lib/awareness/view";
import { renderMarkdown } from "@/lib/workspace/markdown";

export default async function LessonPage({ params }: PageProps<"/lernen/kurs/[lesson]">) {
  const { lesson: id } = await params;
  const { course, done, fill } = await learnerContext();
  const index = course.lessons.findIndex((l) => l.id === id);
  if (index < 0) notFound();
  const lesson = course.lessons[index];
  const previous = course.lessons[index - 1];

  return (
    <article className="space-y-5">
      <div>
        <Link href="/lernen" className="text-sm text-slate-500 hover:text-slate-900">
          ← Übersicht
        </Link>
        <p className="mt-2 text-xs font-semibold tracking-wide text-emerald-700 uppercase">
          Teil {index + 1} von {course.lessons.length} · {lesson.minutes} Minuten
        </p>
        <h1 className="text-2xl font-bold">{lesson.title}</h1>
      </div>
      <div
        className="doc-content rounded-2xl bg-white p-5 leading-relaxed shadow-sm ring-1 ring-slate-200"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(fill(lesson.body)) }}
      />
      <section className="rounded-2xl bg-emerald-50 p-5 ring-1 ring-emerald-200">
        <h2 className="font-semibold text-emerald-900">Das Wichtigste</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-950">
          {lesson.keyPoints.map((point) => (
            <li key={point}>{fill(point)}</li>
          ))}
        </ul>
      </section>
      <div className="flex items-center justify-between gap-3">
        {previous ? (
          <Link href={`/lernen/kurs/${previous.id}`} className="text-sm text-slate-500 hover:text-slate-900">
            ← {previous.title}
          </Link>
        ) : (
          <span />
        )}
        <form action={completeLesson}>
          <input type="hidden" name="courseId" value={course.id} />
          <input type="hidden" name="step" value={lesson.id} />
          <button type="submit" className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-700">
            {done.has(lesson.id) ? "Weiter" : "Verstanden – weiter"}
          </button>
        </form>
      </div>
    </article>
  );
}
