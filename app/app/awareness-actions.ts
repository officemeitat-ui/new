"use server";

import { revalidatePath } from "next/cache";
import { workspace } from "@/config/workspace";
import { logAction, requireAdmin } from "@/lib/auth";
import { KI_KOMPETENZ, SELF_ASSESSMENT } from "@/lib/awareness/content";
import { learnerLink, publicBase } from "@/lib/awareness/session";
import {
  addLearners,
  fillPlaceholders,
  getLearner,
  impulseFor,
  listLearners,
  markInvited,
  orgContacts,
  orgName,
  parseLearnerList,
  renewLearnerToken,
  saveAssessment,
  saveOrgContacts,
  setLearnerDisabled,
} from "@/lib/awareness/store";
import { createMailDraft, outlookConfigured } from "@/lib/workspace/outlook";

export type AwarenessState = {
  ok?: boolean;
  error?: string;
  message?: string;
  links?: { name: string; email: string | null; url: string }[];
};

async function org(formData: FormData) {
  const id = String(formData.get("org") ?? "");
  const name = await orgName(id);
  if (!name) throw new Error("Organisation nicht gefunden");
  return { id, name };
}

/** Outlook-Postfach gehört der Inhaberin bzw. dem Inhaber – nur dann Entwürfe dort anlegen. */
const draftsAllowed = (role: string) => outlookConfigured() && role === "inhaber";

function invitationText(name: string, firma: string, url: string) {
  return [
    `Guten Tag ${name},`,
    "",
    `für ${firma} gibt es eine kurze Online-Schulung „${KI_KOMPETENZ.title}“ (ca. ${KI_KOMPETENZ.minutes} Minuten, am Handy oder PC, jederzeit unterbrechbar).`,
    "Sie lernen, wie Sie KI-Werkzeuge sicher nutzen und wie Betrüger mit gefälschten Stimmen, E-Mails und Nachrichten arbeiten.",
    "Zum Abschluss gibt es ein kurzes Quiz und einen Teilnahmenachweis (Schulungspflicht nach dem EU-KI-Gesetz, Art. 4).",
    "",
    `Ihr persönlicher Zugang (bitte nicht weitergeben): ${url}`,
    "",
    "Viel Erfolg!",
    workspace.company,
  ].join("\n");
}

export async function saveContactsAction(_prev: AwarenessState, formData: FormData): Promise<AwarenessState> {
  await requireAdmin();
  try {
    const { id } = await org(formData);
    await saveOrgContacts(id, {
      meldestelle: String(formData.get("meldestelle") ?? ""),
      notfall: String(formData.get("notfall") ?? ""),
      hausbank: String(formData.get("hausbank") ?? ""),
    });
    revalidatePath(`/app/awareness/${id}`);
    return { ok: true, message: "Gespeichert – die Schulung zeigt jetzt diese Kontakte." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Speichern fehlgeschlagen" };
  }
}

export async function addLearnersAction(_prev: AwarenessState, formData: FormData): Promise<AwarenessState> {
  const user = await requireAdmin();
  let target;
  try {
    target = await org(formData);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Organisation nicht gefunden" };
  }
  const entries = parseLearnerList(String(formData.get("list") ?? ""));
  if (!entries.length) return { error: "Bitte je Zeile „Name; E-Mail“ eintragen" };
  const created = await addLearners(target.id, entries);
  const base = await publicBase();
  const links = created.map(({ learner, token }) => ({ name: learner.name, email: learner.email, url: learnerLink(base, token) }));
  let drafts = 0;
  if (formData.get("drafts") === "on" && draftsAllowed(user.role)) {
    for (const link of links.filter((l) => l.email)) {
      await createMailDraft({
        to: [link.email!],
        subject: `Schulung: ${KI_KOMPETENZ.title}`,
        body: invitationText(link.name, target.name, link.url),
      });
      drafts++;
    }
    await markInvited(created.filter((c) => c.learner.email).map((c) => c.learner.id));
  }
  await logAction("Awareness: Teilnehmende angelegt", `${target.name}: ${created.length}`);
  revalidatePath(`/app/awareness/${target.id}`);
  const skipped = entries.length - created.length;
  return {
    ok: true,
    links,
    message: [
      `${created.length} angelegt.`,
      skipped ? `${skipped} gab es schon.` : "",
      drafts
        ? `${drafts} Einladungen liegen als Entwurf in Outlook.`
        : "Links unten kopieren und verschicken – sie werden nur jetzt angezeigt.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export async function renewLinkAction(_prev: AwarenessState, formData: FormData): Promise<AwarenessState> {
  const user = await requireAdmin();
  const learner = await getLearner(String(formData.get("learnerId") ?? ""));
  if (!learner) return { error: "Nicht gefunden" };
  const token = await renewLearnerToken(learner.id);
  const url = learnerLink(await publicBase(), token);
  let message = "Neuer Link – der alte gilt nicht mehr.";
  if (formData.get("draft") === "on" && learner.email && draftsAllowed(user.role)) {
    await createMailDraft({
      to: [learner.email],
      subject: `Schulung: ${KI_KOMPETENZ.title}`,
      body: invitationText(learner.name, (await orgName(learner.org)) ?? "", url),
    });
    await markInvited([learner.id]);
    message += " Einladung liegt als Entwurf in Outlook.";
  }
  await logAction("Awareness: neuer Zugangslink", learner.name);
  revalidatePath(`/app/awareness/${learner.org}`);
  return { ok: true, message, links: [{ name: learner.name, email: learner.email, url }] };
}

export async function toggleLearnerAction(formData: FormData) {
  await requireAdmin();
  const learner = await getLearner(String(formData.get("learnerId") ?? ""));
  if (!learner) return;
  await setLearnerDisabled(learner.id, !learner.disabled);
  await logAction(learner.disabled ? "Awareness: Teilnahme reaktiviert" : "Awareness: Teilnahme deaktiviert", learner.name);
  revalidatePath(`/app/awareness/${learner.org}`);
}

/** Impuls des Monats als Outlook-Entwurf: an dich selbst, alle Teilnehmenden in BCC. */
export async function impulseDraftAction(_prev: AwarenessState, formData: FormData): Promise<AwarenessState> {
  const user = await requireAdmin();
  if (!draftsAllowed(user.role)) return { error: "Outlook-Entwürfe sind nur für das Inhaber-Konto mit verbundenem Outlook möglich." };
  const target = await org(formData);
  const impulse = impulseFor(new Date());
  const recipients = (await listLearners(target.id)).filter((l) => !l.disabled && l.email).map((l) => l.email!);
  if (!recipients.length) return { error: "Keine Teilnehmenden mit E-Mail-Adresse" };
  const contacts = await orgContacts(target.id);
  await createMailDraft({
    to: [process.env.MS_MAILBOX ?? ""].filter(Boolean),
    bcc: recipients,
    subject: impulse.subject,
    body: fillPlaceholders(impulse.text, target.name, contacts),
  });
  await logAction("Awareness: Monatsimpuls als Entwurf", `${target.name}: ${impulse.title}`);
  return { ok: true, message: `Entwurf „${impulse.subject}“ an ${recipients.length} Personen (BCC) liegt in Outlook.` };
}

export async function saveAssessmentAction(_prev: AwarenessState, formData: FormData): Promise<AwarenessState> {
  const user = await requireAdmin();
  const target = await org(formData);
  const answers: Record<string, number> = {};
  for (const question of SELF_ASSESSMENT.sections.flatMap((s) => s.questions)) {
    const value = formData.get(question.id);
    if (value !== null) answers[question.id] = Number(value);
  }
  const score = await saveAssessment(target.id, answers, user.name);
  await logAction("Awareness: Selbstbewertung", `${target.name}: ${score}/${SELF_ASSESSMENT.max}`);
  revalidatePath(`/app/awareness/${target.id}`);
  return { ok: true, message: `Gespeichert: ${score} von ${SELF_ASSESSMENT.max} Punkten.` };
}
