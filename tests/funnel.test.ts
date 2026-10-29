import { describe, expect, it } from "vitest";
import { funnels } from "@/config/site";
import { describeAnswers, maxScore, scoreAnswers, toPublicFunnel, type Funnel } from "@/lib/funnel";

const funnel: Funnel = {
  id: "test",
  pipelineId: "vertrieb",
  title: "Test",
  intro: "",
  threshold: 4,
  stageQualified: "qualifiziert",
  stageNotQualified: "neu",
  showBooking: true,
  contactFields: [],
  outcome: { qualified: { title: "", text: "" }, notQualified: { title: "", text: "" } },
  questions: [
    {
      id: "a",
      title: "Frage A",
      options: [
        { id: "gut", label: "Gut", points: 3 },
        { id: "mittel", label: "Mittel", points: 1 },
        { id: "aus", label: "Ausschluss", points: 5, disqualify: true },
      ],
    },
    {
      id: "b",
      title: "Frage B",
      options: [
        { id: "ja", label: "Ja", points: 2 },
        { id: "nein", label: "Nein", points: 0 },
      ],
    },
  ],
};

describe("scoreAnswers", () => {
  it("qualifiziert ab Erreichen der Schwelle", () => {
    expect(scoreAnswers(funnel, { a: "gut", b: "ja" })).toEqual({ ok: true, score: 5, maxScore: 7, qualified: true });
    expect(scoreAnswers(funnel, { a: "mittel", b: "ja" })).toMatchObject({ ok: true, score: 3, qualified: false });
  });

  it("Ausschluss-Antwort verhindert Qualifizierung trotz hohem Score", () => {
    expect(scoreAnswers(funnel, { a: "aus", b: "ja" })).toMatchObject({ ok: true, score: 7, qualified: false });
  });

  it("lehnt fehlende und unbekannte Antworten ab", () => {
    expect(scoreAnswers(funnel, { a: "gut" })).toMatchObject({ ok: false });
    expect(scoreAnswers(funnel, { a: "gut", b: "vielleicht" })).toMatchObject({ ok: false });
  });

  it("ignoriert zusätzliche Antworten", () => {
    expect(scoreAnswers(funnel, { a: "gut", b: "ja", extra: "x" })).toMatchObject({ ok: true, score: 5 });
  });
});

describe("Hilfsfunktionen", () => {
  it("maxScore summiert die jeweils beste Antwort", () => {
    expect(maxScore(funnel)).toBe(7);
  });

  it("describeAnswers liefert lesbare Paare", () => {
    expect(describeAnswers(funnel, { a: "gut" })).toEqual([
      { question: "Frage A", answer: "Gut" },
      { question: "Frage B", answer: "–" },
    ]);
  });

  it("toPublicFunnel gibt keine Punkte oder Ausschlusskriterien preis", () => {
    const json = JSON.stringify(toPublicFunnel(funnel));
    expect(json).not.toContain("points");
    expect(json).not.toContain("disqualify");
  });
});

describe("Konfiguration", () => {
  it.each(Object.values(funnels))("Funnel $id ist erreichbar und konsistent", (f) => {
    expect(f.threshold).toBeLessThanOrEqual(maxScore(f));
    for (const q of f.questions) {
      expect(new Set(q.options.map((o) => o.id)).size).toBe(q.options.length);
    }
  });
});
