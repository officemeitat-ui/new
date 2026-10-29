// Typen und Bewertungslogik für Qualifizierungs-Funnels. Rein funktional,
// damit Client (Vorschau) und Server (verbindliche Bewertung) dieselbe Logik nutzen.

export type FunnelOption = {
  id: string;
  label: string;
  /** Punkte, die diese Antwort zum Score beiträgt. */
  points: number;
  /** Antwort schließt eine Qualifizierung unabhängig vom Score aus. */
  disqualify?: boolean;
};

export type FunnelQuestion = {
  id: string;
  title: string;
  hint?: string;
  options: FunnelOption[];
};

export type ContactFieldId = "name" | "email" | "phone" | "company" | "link" | "message";

export type ContactField = {
  id: ContactFieldId;
  label: string;
  type: "text" | "email" | "tel" | "url" | "textarea";
  required: boolean;
  placeholder?: string;
};

export type FunnelOutcome = { title: string; text: string };

export type Funnel = {
  id: string;
  /** Pipeline, in der Einträge dieses Funnels landen. */
  pipelineId: string;
  title: string;
  intro: string;
  questions: FunnelQuestion[];
  contactFields: ContactField[];
  /** Mindestpunktzahl für „qualifiziert“. */
  threshold: number;
  stageQualified: string;
  stageNotQualified: string;
  /** Nach erfolgreicher Qualifizierung Terminbuchung anzeigen. */
  showBooking: boolean;
  outcome: { qualified: FunnelOutcome; notQualified: FunnelOutcome };
};

export type Answers = Record<string, string>;

export type ScoreResult =
  | { ok: true; score: number; maxScore: number; qualified: boolean }
  | { ok: false; error: string };

export function maxScore(funnel: Funnel): number {
  return funnel.questions.reduce(
    (sum, q) => sum + Math.max(0, ...q.options.map((o) => o.points)),
    0,
  );
}

export function scoreAnswers(funnel: Funnel, answers: Answers): ScoreResult {
  let score = 0;
  let disqualified = false;

  for (const question of funnel.questions) {
    const optionId = answers[question.id];
    const option = question.options.find((o) => o.id === optionId);
    if (!option) {
      return { ok: false, error: `Antwort fehlt oder ist ungültig: ${question.title}` };
    }
    score += option.points;
    if (option.disqualify) disqualified = true;
  }

  return {
    ok: true,
    score,
    maxScore: maxScore(funnel),
    qualified: !disqualified && score >= funnel.threshold,
  };
}

/** Antworten als lesbare Frage/Antwort-Paare, z. B. für Admin-Ansicht und KI-Prompts. */
export function describeAnswers(
  funnel: Funnel,
  answers: Answers,
): { question: string; answer: string }[] {
  return funnel.questions.map((q) => ({
    question: q.title,
    answer: q.options.find((o) => o.id === answers[q.id])?.label ?? "–",
  }));
}

/** Funnel ohne Punkte und Ausschlusskriterien – nur das wird an den Browser gegeben. */
export type PublicFunnel = {
  id: string;
  title: string;
  intro: string;
  questions: { id: string; title: string; hint?: string; options: { id: string; label: string }[] }[];
  contactFields: ContactField[];
};

export function toPublicFunnel(funnel: Funnel): PublicFunnel {
  return {
    id: funnel.id,
    title: funnel.title,
    intro: funnel.intro,
    questions: funnel.questions.map((q) => ({
      id: q.id,
      title: q.title,
      hint: q.hint,
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
    })),
    contactFields: funnel.contactFields,
  };
}
