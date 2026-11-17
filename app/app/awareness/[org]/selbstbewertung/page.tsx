import Link from "next/link";
import { notFound } from "next/navigation";
import { AssessmentForm } from "@/components/awareness/AdminUI";
import { requireAdmin } from "@/lib/auth";
import { SELF_ASSESSMENT } from "@/lib/awareness/content";
import { listAssessments, orgName } from "@/lib/awareness/store";

export default async function SelbstbewertungPage({ params }: PageProps<"/app/awareness/[org]/selbstbewertung">) {
  await requireAdmin();
  const { org } = await params;
  const name = await orgName(org);
  if (!name) notFound();
  const last = (await listAssessments(org))[0];
  return (
    <div className="space-y-4">
      <Link href={`/app/awareness/${org}`} className="text-sm text-slate-500 hover:text-slate-900">
        ← {name}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Selbstbewertung {name}</h1>
        <p className="text-sm text-slate-500">
          {SELF_ASSESSMENT.scale.map((s) => `${s.label} = ${s.points}`).join(" · ")}. ★ = Kernfrage.{" "}
          {last ? "Vorausgefüllt mit der letzten Bewertung." : ""}
        </p>
      </div>
      <AssessmentForm org={org} assessment={SELF_ASSESSMENT} initial={last?.answers ?? {}} />
    </div>
  );
}
