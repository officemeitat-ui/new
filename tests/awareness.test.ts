import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { KI_KOMPETENZ, MONTHLY_IMPULSES, SELF_ASSESSMENT, VERIFICATION_RULES } from "@/lib/awareness/content";

process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "awareness-")), "test.db")}`;
process.env.SESSION_SECRET = "test-session-geheimnis";

let store: typeof import("@/lib/awareness/store");
let customerId: string;

beforeAll(async () => {
  store = await import("@/lib/awareness/store");
  const customers = await import("@/lib/workspace/customers");
  customerId = (await customers.createCustomer({ name: "Huber Steuerberatung" })).id;
});

const now = new Date("2026-11-17T08:00:00Z");
const correct = KI_KOMPETENZ.quiz.map((q) => q.correct);

describe("Inhalte aus dem Awareness-Paket", () => {
  it("sind vollständig und stimmig", () => {
    expect(KI_KOMPETENZ.lessons.length).toBeGreaterThanOrEqual(5);
    expect(KI_KOMPETENZ.scenarios).toHaveLength(6);
    expect(KI_KOMPETENZ.quiz).toHaveLength(10);
    // Lösungen laut Anhang M.5: 1 b · 2 c · 3 b · 4 a · 5 b · 6 b · 7 b · 8 c · 9 b · 10 a
    expect(correct).toEqual([1, 2, 1, 0, 1, 1, 1, 2, 1, 0]);
    for (const q of KI_KOMPETENZ.quiz) expect(q.options[q.correct]).toBeTruthy();
    expect(MONTHLY_IMPULSES.map((i) => i.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(SELF_ASSESSMENT.sections.reduce((sum, s) => sum + s.max, 0)).toBe(SELF_ASSESSMENT.max);
    for (const section of SELF_ASSESSMENT.sections) expect(section.questions.length * 2).toBe(section.max);
    const everything = JSON.stringify({ KI_KOMPETENZ, MONTHLY_IMPULSES, SELF_ASSESSMENT, VERIFICATION_RULES });
    expect(everything).not.toContain("[ANPASSEN");
    expect(new Set(everything.match(/\{\{\w+\}\}/g))).toEqual(new Set(["{{firma}}", "{{meldestelle}}", "{{notfall}}", "{{hausbank}}"]));
  });

  it("füllt Platzhalter und nimmt sonst neutrale Formulierungen", () => {
    const text = "Melden an {{meldestelle}}, nachts {{notfall}}, Bank {{hausbank}} – {{firma}}";
    expect(store.fillPlaceholders(text, "Huber", { meldestelle: "IT 0732 1", notfall: "", hausbank: "" })).toBe(
      "Melden an IT 0732 1, nachts die interne Notfallnummer, Bank die Notfallnummer Ihrer Hausbank – Huber",
    );
  });

  it("wählt den Impuls des Monats nach dem Startmonat", () => {
    expect(store.impulseFor(new Date("2026-01-15T12:00:00Z")).month).toBe(1);
    expect(store.impulseFor(now).month).toBe(11);
  });
});

describe("Lernende, Fortschritt, Quiz", () => {
  it("liest Listen aus Excel, Outlook und Hand", () => {
    expect(
      store.parseLearnerList("Maria Huber; maria@huber.at\nPeter Gruber <p.gruber@huber.at>\nAnna Lang\tanna@huber.at\n\nNur Name"),
    ).toEqual([
      { name: "Maria Huber", email: "maria@huber.at" },
      { name: "Peter Gruber", email: "p.gruber@huber.at" },
      { name: "Anna Lang", email: "anna@huber.at" },
      { name: "Nur Name", email: null },
    ]);
  });

  it("legt Lernende mit persönlichem Link an (gespeichert nur als Hash)", async () => {
    const created = await store.addLearners(
      customerId,
      store.parseLearnerList("Maria Huber; Maria@Huber.at\nPeter Gruber; p@huber.at"),
      now,
    );
    expect(created).toHaveLength(2);
    expect(created[0].learner).toMatchObject({ name: "Maria Huber", email: "maria@huber.at", org: customerId });
    expect(await store.addLearners(customerId, [{ name: "Maria", email: "maria@huber.at" }], now)).toHaveLength(0);

    const { db } = await import("@/lib/db");
    const rows = (await (await db()).execute("SELECT token_hash FROM awareness_learners")).rows;
    expect(rows.map((r) => String(r.token_hash))).not.toContain(created[0].token);

    expect((await store.learnerByToken(created[0].token, now))!.id).toBe(created[0].learner.id);
    expect(await store.learnerByToken("falsch-falsch-falsch-falsch", now)).toBeNull();
    const renewed = await store.renewLearnerToken(created[0].learner.id);
    expect(await store.learnerByToken(created[0].token, now)).toBeNull();
    expect(await store.learnerByToken(renewed, now)).not.toBeNull();
    await store.setLearnerDisabled(created[1].learner.id, true, now);
    expect(await store.learnerByToken(created[1].token, now)).toBeNull();
  });

  it("zählt Fortschritt und wertet das Quiz serverseitig aus", async () => {
    const maria = (await store.listLearners(customerId, now)).find((l) => l.name === "Maria Huber")!;
    expect(maria).toMatchObject({ state: "neu", stepsDone: 0, stepsTotal: KI_KOMPETENZ.lessons.length + 1 });
    await store.completeStep(maria.id, KI_KOMPETENZ.id, KI_KOMPETENZ.lessons[0].id, now);
    await store.completeStep(maria.id, KI_KOMPETENZ.id, KI_KOMPETENZ.lessons[0].id, now);
    await expect(store.completeStep(maria.id, KI_KOMPETENZ.id, "gibt-es-nicht", now)).rejects.toThrow("Unbekannter Schritt");

    const sevenRight = correct.map((c, i) => (i < 3 ? (c + 1) % 3 : c));
    const failed = await store.submitQuiz(maria.id, KI_KOMPETENZ.id, sevenRight, now);
    expect(failed).toMatchObject({ score: 7, total: 10, passed: false });
    await expect(store.submitQuiz(maria.id, KI_KOMPETENZ.id, [1, 2], now)).rejects.toThrow("alle Fragen");

    const eightRight = correct.map((c, i) => (i < 2 ? (c + 1) % 3 : c));
    const passed = await store.submitQuiz(maria.id, KI_KOMPETENZ.id, eightRight, now);
    expect(passed).toMatchObject({ score: 8, passed: true });

    const status = (await store.listLearners(customerId, now)).find((l) => l.id === maria.id)!;
    expect(status).toMatchObject({ state: "bestanden", stepsDone: 1, validUntil: "2027-11-17T08:00:00.000Z" });
    expect(status.best!.id).toBe(passed.id);
    const soon = (await store.listLearners(customerId, new Date("2027-11-01T00:00:00Z"))).find((l) => l.id === maria.id)!;
    expect(soon.state).toBe("laeuft_ab");
    const later = (await store.listLearners(customerId, new Date("2027-12-01T00:00:00Z"))).find((l) => l.id === maria.id)!;
    expect(later.state).toBe("abgelaufen");
  });

  it("erstellt die Nachweisliste und die Übersicht", async () => {
    const csv = store.evidenceCsv("Huber Steuerberatung", await store.listLearners(customerId, now), "Europe/Vienna");
    expect(csv.startsWith("\uFEFFOrganisation;Name;E-Mail;Kurs;Status")).toBe(true);
    expect(csv).toContain("Huber Steuerberatung;Maria Huber;maria@huber.at;KI sicher nutzen und KI-Angriffe erkennen;bestanden;1/");
    expect(csv).toContain(";8/10;17.11.2026;17.11.2027;");

    const overview = await store.overview(now);
    expect(overview[0]).toMatchObject({ org: "intern", learners: 0 });
    expect(overview.find((o) => o.org === customerId)).toMatchObject({ name: "Huber Steuerberatung", learners: 1, passed: 1 });
  });
});

describe("Selbstbewertung", () => {
  it("zählt Punkte, ignoriert ungültige Werte und ordnet ein", async () => {
    const answers: Record<string, number> = {};
    for (const q of SELF_ASSESSMENT.sections.flatMap((s) => s.questions)) answers[q.id] = 2;
    expect(store.scoreAssessment(answers)).toBe(SELF_ASSESSMENT.max);
    expect(store.scoreAssessment({ "1.1": 2, "1.2": 5, "1.3": 1 })).toBe(3);
    expect(store.ratingFor(0).min).toBe(0);
    expect(store.ratingFor(SELF_ASSESSMENT.max).min).toBe(Math.max(...SELF_ASSESSMENT.ratings.map((r) => r.min)));
    expect(await store.saveAssessment("intern", { "1.1": 2, "2.1": 1 }, "Max", now)).toBe(3);
    expect((await store.listAssessments("intern"))[0]).toMatchObject({ score: 3, createdBy: "Max" });
  });
});
