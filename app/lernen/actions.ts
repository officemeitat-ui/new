"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentLearner, LEARNER_COOKIE } from "@/lib/awareness/session";
import { completeStep, EXERCISE_STEP, findCourse, submitQuiz } from "@/lib/awareness/store";

export type QuizState = { error?: string };

async function learnerOrHome() {
  const learner = await currentLearner();
  if (!learner) redirect("/lernen");
  return learner;
}

export async function completeLesson(formData: FormData) {
  const learner = await learnerOrHome();
  const course = findCourse(String(formData.get("courseId") ?? ""));
  if (!course) redirect("/lernen");
  const step = String(formData.get("step") ?? "");
  await completeStep(learner.id, course.id, step);
  const index = course.lessons.findIndex((l) => l.id === step);
  const next = course.lessons[index + 1];
  redirect(next ? `/lernen/kurs/${next.id}` : "/lernen/uebung");
}

export async function completeExercise(formData: FormData) {
  const learner = await learnerOrHome();
  const course = findCourse(String(formData.get("courseId") ?? ""));
  if (!course) redirect("/lernen");
  await completeStep(learner.id, course.id, EXERCISE_STEP);
  redirect("/lernen/quiz");
}

export async function sendQuiz(_prev: QuizState, formData: FormData): Promise<QuizState> {
  const learner = await learnerOrHome();
  const course = findCourse(String(formData.get("courseId") ?? ""));
  if (!course) return { error: "Unbekannter Kurs" };
  const answers = course.quiz.map((q) => {
    const value = formData.get(q.id);
    return value === null ? -1 : Number(value);
  });
  if (answers.some((a) => !Number.isInteger(a) || a < 0)) return { error: "Bitte alle Fragen beantworten." };
  const attempt = await submitQuiz(learner.id, course.id, answers);
  redirect(`/lernen/ergebnis/${attempt.id}`);
}

export async function leaveLearning() {
  (await cookies()).delete({ name: LEARNER_COOKIE, path: "/lernen" });
  redirect("/lernen");
}
