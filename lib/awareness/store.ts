import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { workspace } from "@/config/workspace";
import { KI_KOMPETENZ, MONTHLY_IMPULSES, SELF_ASSESSMENT, type AwarenessCourse, type MonthlyImpulse } from "@/lib/awareness/content";
import { db } from "@/lib/db";
import { getCustomer } from "@/lib/workspace/customers";

// Security-Awareness: Lernende je Organisation (eigenes Team = „intern“ oder ein Kunde), persönlicher Zugangslink,
// Fortschritt, Abschlussquiz mit Teilnahmenachweis (AI Act Art. 4), Selbstbewertung und Monatsimpulse.

export const ORG_INTERN = "intern";
export const COURSES: AwarenessCourse[] = [KI_KOMPETENZ];
export const EXERCISE_STEP = "uebung";

export type Learner = {
  id: string;
  org: string;
  name: string;
  email: string | null;
  invitedAt: string | null;
  lastSeenAt: string | null;
  disabled: boolean;
  createdAt: string;
};

export type Attempt = {
  id: string;
  learnerId: string;
  courseId: string;
  score: number;
  total: number;
  passed: boolean;
  answers: number[];
  createdAt: string;
};

export type LearnerStatus = Learner & {
  stepsDone: number;
  stepsTotal: number;
  best: Attempt | null;
  validUntil: string | null;
  state: "neu" | "begonnen" | "bestanden" | "laeuft_ab" | "abgelaufen";
};

export type OrgContacts = { meldestelle: string; notfall: string; hausbank: string };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const toLearner = (r: Record<string, unknown>): Learner => ({
  id: String(r.id),
  org: String(r.org),
  name: String(r.name),
  email: (r.email as string | null) ?? null,
  invitedAt: (r.invited_at as string | null) ?? null,
  lastSeenAt: (r.last_seen_at as string | null) ?? null,
  disabled: Boolean(r.disabled_at),
  createdAt: String(r.created_at),
});

const toAttempt = (r: Record<string, unknown>): Attempt => ({
  id: String(r.id),
  learnerId: String(r.learner_id),
  courseId: String(r.course_id),
  score: Number(r.score),
  total: Number(r.total),
  passed: Boolean(r.passed),
  answers: JSON.parse(String(r.answers)) as number[],
  createdAt: String(r.created_at),
});

export const findCourse = (id: string) => COURSES.find((c) => c.id === id) ?? null;
export const courseSteps = (course: AwarenessCourse) => [...course.lessons.map((l) => l.id), EXERCISE_STEP];

export function addMonths(iso: string, months: number): string {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

// ── Organisationen ──

export async function orgName(org: string): Promise<string | null> {
  if (org === ORG_INTERN) return workspace.company;
  return (await getCustomer(org))?.name ?? null;
}

export async function orgContacts(org: string): Promise<OrgContacts> {
  const result = await (await db()).execute({ sql: "SELECT * FROM awareness_orgs WHERE org = ?", args: [org] });
  const r = result.rows[0];
  return { meldestelle: String(r?.meldestelle ?? ""), notfall: String(r?.notfall ?? ""), hausbank: String(r?.hausbank ?? "") };
}

export async function saveOrgContacts(org: string, contacts: OrgContacts, now = new Date()) {
  await (
    await db()
  ).execute({
    sql: `INSERT INTO awareness_orgs (org, meldestelle, notfall, hausbank, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(org) DO UPDATE SET meldestelle = excluded.meldestelle, notfall = excluded.notfall,
          hausbank = excluded.hausbank, updated_at = excluded.updated_at`,
    args: [org, contacts.meldestelle.trim(), contacts.notfall.trim(), contacts.hausbank.trim(), now.toISOString()],
  });
}

/** Platzhalter in den Lerninhalten mit den Angaben der Organisation füllen (fehlende Angaben neutral umschreiben). */
export function fillPlaceholders(text: string, firma: string, contacts: OrgContacts): string {
  return text
    .replace(/\{\{firma\}\}/g, firma)
    .replace(/\{\{meldestelle\}\}/g, contacts.meldestelle || "Ihre IT bzw. Informationssicherheit")
    .replace(/\{\{notfall\}\}/g, contacts.notfall || "die interne Notfallnummer")
    .replace(/\{\{hausbank\}\}/g, contacts.hausbank || "die Notfallnummer Ihrer Hausbank");
}

/** Impuls des Monats nach Jahresplan (Startmonat in config/workspace.ts). */
export function impulseFor(date: Date): MonthlyImpulse {
  const month = Number(new Intl.DateTimeFormat("en-CA", { month: "numeric", timeZone: workspace.timeZone }).format(date));
  const index = (month - workspace.awareness.startMonth + 12) % 12;
  return MONTHLY_IMPULSES[index];
}

// ── Lernende ──

/** Legt Lernende an und liefert ihre persönlichen Zugangsschlüssel – nur jetzt im Klartext (gespeichert wird der Hash). */
export async function addLearners(
  org: string,
  entries: { name: string; email?: string | null }[],
  now = new Date(),
): Promise<{ learner: Learner; token: string }[]> {
  const client = await db();
  const created: { learner: Learner; token: string }[] = [];
  for (const entry of entries) {
    const name = entry.name.trim();
    if (!name) continue;
    const email = entry.email?.trim().toLowerCase() || null;
    if (email) {
      const existing = await client.execute({ sql: "SELECT id FROM awareness_learners WHERE org = ? AND email = ?", args: [org, email] });
      if (existing.rows[0]) continue;
    }
    const token = randomBytes(24).toString("base64url");
    const id = randomUUID();
    await client.execute({
      sql: "INSERT INTO awareness_learners (id, org, name, email, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [id, org, name, email, sha256(token), now.toISOString()],
    });
    created.push({ learner: (await getLearner(id))!, token });
  }
  return created;
}

/** „Name; E-Mail“ oder „Name <mail>“ je Zeile – auch direkt aus Excel kopiert (Tabulator). */
export function parseLearnerList(text: string): { name: string; email: string | null }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const email = line.match(/[^\s<>;,\t]+@[^\s<>;,\t]+\.[^\s<>;,\t]+/)?.[0] ?? null;
      const name = (email ? line.replace(email, "") : line)
        .replace(/[<>;,\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { name: name || email?.split("@")[0] || "", email };
    })
    .filter((entry) => entry.name);
}

export async function getLearner(id: string): Promise<Learner | null> {
  const result = await (await db()).execute({ sql: "SELECT * FROM awareness_learners WHERE id = ?", args: [id] });
  return result.rows[0] ? toLearner(result.rows[0] as Record<string, unknown>) : null;
}

export async function learnerByToken(token: string, now = new Date()): Promise<Learner | null> {
  if (!token || token.length < 20) return null;
  const client = await db();
  const result = await client.execute({ sql: "SELECT * FROM awareness_learners WHERE token_hash = ?", args: [sha256(token)] });
  const r = result.rows[0];
  if (!r || r.disabled_at) return null;
  await client.execute({ sql: "UPDATE awareness_learners SET last_seen_at = ? WHERE id = ?", args: [now.toISOString(), r.id] });
  return toLearner(r as Record<string, unknown>);
}

/** Neuer Link (der alte gilt nicht mehr). */
export async function renewLearnerToken(id: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await (await db()).execute({ sql: "UPDATE awareness_learners SET token_hash = ? WHERE id = ?", args: [sha256(token), id] });
  return token;
}

export async function markInvited(ids: string[], now = new Date()) {
  const client = await db();
  for (const id of ids) {
    await client.execute({ sql: "UPDATE awareness_learners SET invited_at = ? WHERE id = ?", args: [now.toISOString(), id] });
  }
}

export async function setLearnerDisabled(id: string, disabled: boolean, now = new Date()) {
  await (
    await db()
  ).execute({ sql: "UPDATE awareness_learners SET disabled_at = ? WHERE id = ?", args: [disabled ? now.toISOString() : null, id] });
}

export async function touchLearner(id: string, now = new Date()) {
  await (await db()).execute({ sql: "UPDATE awareness_learners SET last_seen_at = ? WHERE id = ?", args: [now.toISOString(), id] });
}

// ── Fortschritt und Quiz ──

export async function completeStep(learnerId: string, courseId: string, step: string, now = new Date()) {
  const course = findCourse(courseId);
  if (!course || !courseSteps(course).includes(step)) throw new Error("Unbekannter Schritt");
  await (
    await db()
  ).execute({
    sql: "INSERT OR IGNORE INTO awareness_progress (learner_id, course_id, step, completed_at) VALUES (?, ?, ?, ?)",
    args: [learnerId, courseId, step, now.toISOString()],
  });
}

export async function stepsDone(learnerId: string, courseId: string): Promise<Set<string>> {
  const result = await (
    await db()
  ).execute({ sql: "SELECT step FROM awareness_progress WHERE learner_id = ? AND course_id = ?", args: [learnerId, courseId] });
  return new Set(result.rows.map((r) => String(r.step)));
}

/** Wertet das Quiz aus (die richtigen Antworten kennt nur der Server). */
export async function submitQuiz(learnerId: string, courseId: string, answers: number[], now = new Date()): Promise<Attempt> {
  const course = findCourse(courseId);
  if (!course) throw new Error("Unbekannter Kurs");
  if (answers.length !== course.quiz.length) throw new Error("Bitte alle Fragen beantworten");
  const score = course.quiz.filter((q, i) => answers[i] === q.correct).length;
  const passed = score * 100 >= course.passPercent * course.quiz.length;
  const id = randomUUID();
  await (
    await db()
  ).execute({
    sql: "INSERT INTO awareness_attempts (id, learner_id, course_id, score, total, passed, answers, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, learnerId, courseId, score, course.quiz.length, passed ? 1 : 0, JSON.stringify(answers), now.toISOString()],
  });
  return (await getAttempt(id))!;
}

export async function getAttempt(id: string): Promise<Attempt | null> {
  const result = await (await db()).execute({ sql: "SELECT * FROM awareness_attempts WHERE id = ?", args: [id] });
  return result.rows[0] ? toAttempt(result.rows[0] as Record<string, unknown>) : null;
}

/** Letzter bestandener Versuch, sonst der letzte Versuch. */
export async function bestAttempt(learnerId: string, courseId: string): Promise<Attempt | null> {
  const result = await (
    await db()
  ).execute({
    sql: "SELECT * FROM awareness_attempts WHERE learner_id = ? AND course_id = ? ORDER BY passed DESC, created_at DESC LIMIT 1",
    args: [learnerId, courseId],
  });
  return result.rows[0] ? toAttempt(result.rows[0] as Record<string, unknown>) : null;
}

export async function learnerStatus(learner: Learner, course: AwarenessCourse, now = new Date()): Promise<LearnerStatus> {
  const [done, best] = await Promise.all([stepsDone(learner.id, course.id), bestAttempt(learner.id, course.id)]);
  const steps = courseSteps(course);
  const validUntil = best?.passed ? addMonths(best.createdAt, course.repeatMonths) : null;
  const soon = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const state: LearnerStatus["state"] = validUntil
    ? validUntil < now.toISOString()
      ? "abgelaufen"
      : validUntil < soon
        ? "laeuft_ab"
        : "bestanden"
    : done.size > 0 || best
      ? "begonnen"
      : "neu";
  return { ...learner, stepsDone: steps.filter((s) => done.has(s)).length, stepsTotal: steps.length, best, validUntil, state };
}

export async function listLearners(org: string, now = new Date()): Promise<LearnerStatus[]> {
  const result = await (await db()).execute({ sql: "SELECT * FROM awareness_learners WHERE org = ? ORDER BY name", args: [org] });
  return Promise.all(result.rows.map((r) => learnerStatus(toLearner(r as Record<string, unknown>), KI_KOMPETENZ, now)));
}

export type OrgOverview = {
  org: string;
  name: string;
  learners: number;
  passed: number;
  open: number;
  expiring: number;
  assessment: { score: number; createdAt: string } | null;
};

export async function overview(now = new Date()): Promise<OrgOverview[]> {
  const client = await db();
  const orgs = await client.execute(
    "SELECT org FROM awareness_learners GROUP BY org UNION SELECT org FROM awareness_assessments UNION SELECT org FROM awareness_orgs",
  );
  const list = new Set<string>([ORG_INTERN, ...orgs.rows.map((r) => String(r.org))]);
  const result: OrgOverview[] = [];
  for (const org of list) {
    const name = await orgName(org);
    if (!name) continue;
    const learners = (await listLearners(org, now)).filter((l) => !l.disabled);
    const latest = (await listAssessments(org))[0];
    result.push({
      org,
      name,
      learners: learners.length,
      passed: learners.filter((l) => l.state === "bestanden" || l.state === "laeuft_ab").length,
      open: learners.filter((l) => l.state === "neu" || l.state === "begonnen" || l.state === "abgelaufen").length,
      expiring: learners.filter((l) => l.state === "laeuft_ab").length,
      assessment: latest ? { score: latest.score, createdAt: latest.createdAt } : null,
    });
  }
  return result.sort((a, b) => Number(b.org === ORG_INTERN) - Number(a.org === ORG_INTERN) || a.name.localeCompare(b.name, "de"));
}

// ── Selbstbewertung ──

export type Assessment = {
  id: string;
  org: string;
  answers: Record<string, number>;
  score: number;
  createdBy: string | null;
  createdAt: string;
};

export function scoreAssessment(answers: Record<string, number>): number {
  const allowed = new Set(SELF_ASSESSMENT.scale.map((s) => s.points));
  return SELF_ASSESSMENT.sections.flatMap((s) => s.questions).reduce((sum, q) => sum + (allowed.has(answers[q.id]) ? answers[q.id] : 0), 0);
}

export const ratingFor = (score: number) =>
  [...SELF_ASSESSMENT.ratings].sort((a, b) => b.min - a.min).find((r) => score >= r.min) ?? SELF_ASSESSMENT.ratings[0];

export async function saveAssessment(org: string, answers: Record<string, number>, createdBy: string | null, now = new Date()) {
  const score = scoreAssessment(answers);
  await (
    await db()
  ).execute({
    sql: "INSERT INTO awareness_assessments (id, org, answers, score, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [randomUUID(), org, JSON.stringify(answers), score, createdBy, now.toISOString()],
  });
  return score;
}

export async function listAssessments(org: string): Promise<Assessment[]> {
  const result = await (
    await db()
  ).execute({ sql: "SELECT * FROM awareness_assessments WHERE org = ? ORDER BY created_at DESC", args: [org] });
  return result.rows.map((r) => ({
    id: String(r.id),
    org: String(r.org),
    answers: JSON.parse(String(r.answers)) as Record<string, number>,
    score: Number(r.score),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
}

/** Nachweisliste als CSV (Excel, Semikolon) – für Auditor, NIS2-Unterlagen oder die Personalakte. */
export function evidenceCsv(orgLabel: string, learners: LearnerStatus[], timeZone: string): string {
  const date = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("de-AT", { dateStyle: "medium", timeZone }).format(new Date(iso)) : "";
  const state = {
    neu: "nicht begonnen",
    begonnen: "begonnen",
    bestanden: "bestanden",
    laeuft_ab: "bestanden (läuft bald ab)",
    abgelaufen: "abgelaufen",
  };
  const cell = (value: string) => (/[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const rows = [
    ["Organisation", "Name", "E-Mail", "Kurs", "Status", "Fortschritt", "Ergebnis", "Bestanden am", "Gültig bis", "Nachweis-Nr."],
    ...learners.map((l) => [
      orgLabel,
      l.name,
      l.email ?? "",
      KI_KOMPETENZ.title,
      state[l.state],
      `${l.stepsDone}/${l.stepsTotal}`,
      l.best ? `${l.best.score}/${l.best.total}` : "",
      l.best?.passed ? date(l.best.createdAt) : "",
      date(l.validUntil),
      l.best?.passed ? l.best.id.slice(0, 8).toUpperCase() : "",
    ]),
  ];
  return "\uFEFF" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
