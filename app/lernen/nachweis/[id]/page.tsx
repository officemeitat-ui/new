import { notFound } from "next/navigation";
import { Certificate } from "@/components/awareness/Certificate";
import { PrintButtons } from "@/components/awareness/PrintButton";
import { currentUser } from "@/lib/auth";
import { currentLearner } from "@/lib/awareness/session";
import { findCourse, getAttempt, getLearner, orgName } from "@/lib/awareness/store";

/** Nachweis: für die Person selbst – und für angemeldete Mitarbeitende des IT-Dienstleisters. */
export default async function NachweisPage({ params }: PageProps<"/lernen/nachweis/[id]">) {
  const { id } = await params;
  const attempt = await getAttempt(id);
  if (!attempt || !attempt.passed) notFound();
  const [learner, staff] = await Promise.all([currentLearner(), currentUser()]);
  if (!staff && learner?.id !== attempt.learnerId) notFound();
  const owner = await getLearner(attempt.learnerId);
  const course = findCourse(attempt.courseId);
  if (!owner || !course) notFound();
  return (
    <>
      <PrintButtons />
      <Certificate name={owner.name} org={(await orgName(owner.org)) ?? ""} course={course} attempt={attempt} />
    </>
  );
}
