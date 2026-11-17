import "server-only";
import { redirect } from "next/navigation";
import { KI_KOMPETENZ } from "@/lib/awareness/content";
import { currentLearner } from "@/lib/awareness/session";
import { fillPlaceholders, learnerStatus, orgContacts, orgName, stepsDone } from "@/lib/awareness/store";

/** Alles, was eine Seite im Lernbereich braucht – ohne Anmeldung geht es zurück zur Startseite. */
export async function learnerContext() {
  const learner = await currentLearner();
  if (!learner) redirect("/lernen");
  const course = KI_KOMPETENZ;
  const [firma, contacts, done, status] = await Promise.all([
    orgName(learner.org),
    orgContacts(learner.org),
    stepsDone(learner.id, course.id),
    learnerStatus(learner, course),
  ]);
  const company = firma ?? "";
  return { learner, course, done, status, firma: company, contacts, fill: (text: string) => fillPlaceholders(text, company, contacts) };
}
