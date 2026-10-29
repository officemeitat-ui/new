import Link from "next/link";
import { notFound } from "next/navigation";
import { getFunnel, getPipeline } from "@/config/site";
import { QualifiedBadge, StageBadge } from "@/components/admin";
import { BriefingForm, CopyButton, FollowUpForm } from "@/components/AiPanels";
import { addNote, moveLeadFromForm, updateValue } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/auth";
import { describeAnswers, maxScore } from "@/lib/funnel";
import { formatDateTime, formatEuro } from "@/lib/format";
import { getLead, listActivities } from "@/lib/leads";
import { findStage, itemValue } from "@/lib/pipeline";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-4 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default async function LeadPage({ params }: PageProps<"/admin/leads/[id]">) {
  await requireAdmin();
  const lead = await getLead((await params).id);
  const funnel = lead && getFunnel(lead.funnel);
  const pipeline = funnel && getPipeline(funnel.pipelineId);
  if (!lead || !funnel || !pipeline) notFound();

  const activities = await listActivities(lead.id);
  const { briefing, followup } = lead;
  const suggested = followup && findStage(pipeline, followup.suggestedStage);
  const mailto = followup
    ? `mailto:${lead.email}?subject=${encodeURIComponent(followup.emailSubject)}&body=${encodeURIComponent(followup.emailBody)}`
    : null;

  return (
    <div>
      <Link href={`/admin/pipeline/${pipeline.id}`} className="text-sm font-medium text-brand hover:underline">
        ← Pipeline {pipeline.label}
      </Link>
      <div className="mt-3 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{lead.name}</h1>
        <StageBadge pipeline={pipeline} stageId={lead.stage} />
        <QualifiedBadge qualified={lead.qualified} />
        <span className="text-sm text-slate-500">
          Score {lead.score}/{maxScore(funnel)} · {funnel.title} · {formatDateTime(lead.createdAt)}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="KI-Gesprächsvorbereitung">
            {briefing ? (
              <div className="space-y-4 text-sm">
                <p className="text-slate-700">{briefing.summary}</p>
                <div>
                  <h3 className="mb-1 font-medium">Vermutete Motivation</h3>
                  <List items={briefing.hypotheses} />
                </div>
                <div>
                  <h3 className="mb-1 font-medium">Fragen fürs Gespräch</h3>
                  <List items={briefing.questions} />
                </div>
                <div>
                  <h3 className="mb-1 font-medium">Mögliche Einwände</h3>
                  <List items={briefing.risks} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Erstellt aus den Funnel-Antworten eine Zusammenfassung und konkrete Gesprächsfragen.</p>
            )}
            <div className="mt-4">
              <BriefingForm leadId={lead.id} hasBriefing={Boolean(briefing)} />
            </div>
          </Card>

          <Card title="Nach dem Gespräch: KI-Follow-up">
            <FollowUpForm leadId={lead.id} />
            {followup && (
              <div className="mt-6 space-y-4 border-t border-slate-100 pt-6 text-sm">
                <p className="text-slate-700">{followup.summary}</p>
                <div>
                  <h3 className="mb-1 font-medium">Nächste Schritte</h3>
                  <List items={followup.nextSteps} />
                </div>
                {suggested && suggested.id !== lead.stage && (
                  <form action={moveLeadFromForm} className="flex items-center gap-3 rounded-lg bg-brand-soft px-4 py-3">
                    <input type="hidden" name="leadId" value={lead.id} />
                    <input type="hidden" name="stage" value={suggested.id} />
                    <span>
                      Empfohlene Stufe: <strong>{suggested.label}</strong>
                    </span>
                    <button type="submit" className="ml-auto font-semibold text-brand hover:underline">
                      Übernehmen
                    </button>
                  </form>
                )}
                <div className="rounded-lg border border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                    <span>
                      <span className="text-slate-500">Betreff:</span> <strong>{followup.emailSubject}</strong>
                    </span>
                    <div className="flex gap-2">
                      <CopyButton text={`${followup.emailSubject}\n\n${followup.emailBody}`} />
                      {mailto && (
                        <a href={mailto} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark">
                          Im Mailprogramm öffnen
                        </a>
                      )}
                    </div>
                  </div>
                  <p className="px-4 py-3 whitespace-pre-wrap text-slate-700">{followup.emailBody}</p>
                </div>
              </div>
            )}
          </Card>

          <Card title="Verlauf">
            <form action={addNote} className="mb-6 flex gap-2">
              <input type="hidden" name="leadId" value={lead.id} />
              <input
                name="note"
                required
                placeholder="Notiz hinzufügen …"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
                Speichern
              </button>
            </form>
            <ol className="space-y-4 border-l-2 border-slate-100 pl-4">
              {activities.map((activity) => (
                <li key={activity.id} className="text-sm">
                  <p className="text-xs text-slate-400">{formatDateTime(activity.createdAt)}</p>
                  <p className="whitespace-pre-wrap text-slate-700">{activity.text}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Kontakt">
            <div className="space-y-2 text-sm">
              {lead.company && <p className="font-medium">{lead.company}</p>}
              <p>
                <a href={`mailto:${lead.email}`} className="text-brand hover:underline">
                  {lead.email}
                </a>
              </p>
              {lead.phone && (
                <p>
                  <a href={`tel:${lead.phone}`} className="text-brand hover:underline">
                    {lead.phone}
                  </a>
                </p>
              )}
              {lead.link && (
                <p>
                  <a href={lead.link} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand hover:underline">
                    {lead.link}
                  </a>
                </p>
              )}
              {lead.message && <p className="whitespace-pre-wrap text-slate-700">{lead.message}</p>}
            </div>
          </Card>

          <Card title="Status">
            <form action={moveLeadFromForm} className="flex gap-2">
              <input type="hidden" name="leadId" value={lead.id} />
              <select name="stage" defaultValue={lead.stage} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {pipeline.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.label} ({stage.probability} %)
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">
                Setzen
              </button>
            </form>
            {pipeline.trackValue && (
              <form action={updateValue} className="mt-3 flex gap-2">
                <input type="hidden" name="leadId" value={lead.id} />
                <input
                  name="value"
                  inputMode="numeric"
                  defaultValue={lead.value ?? ""}
                  placeholder={`Deal-Wert (Standard ${formatEuro(pipeline.defaultValue)})`}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <button type="submit" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">
                  Speichern
                </button>
              </form>
            )}
            {pipeline.trackValue && (
              <p className="mt-2 text-xs text-slate-500">Im Forecast: {formatEuro(itemValue(pipeline, lead))}</p>
            )}
          </Card>

          <Card title="Antworten">
            <dl className="space-y-3 text-sm">
              {describeAnswers(funnel, lead.answers).map(({ question, answer }) => (
                <div key={question}>
                  <dt className="text-slate-500">{question}</dt>
                  <dd className="font-medium">{answer}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {lead.source && (
            <Card title="Quelle">
              <dl className="space-y-1 text-sm">
                {Object.entries(lead.source).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <dt className="text-slate-500">{key}:</dt>
                    <dd className="break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
