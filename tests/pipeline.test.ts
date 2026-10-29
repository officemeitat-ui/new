import { describe, expect, it } from "vitest";
import { funnels, pipelines } from "@/config/site";
import { pipelineStats, type Pipeline } from "@/lib/pipeline";

const pipeline: Pipeline = {
  id: "p",
  label: "P",
  itemLabel: "Lead",
  trackValue: true,
  defaultValue: 1000,
  stages: [
    { id: "neu", label: "Neu", probability: 10 },
    { id: "angebot", label: "Angebot", probability: 50 },
    { id: "won", label: "Gewonnen", probability: 100, closed: "won" },
    { id: "lost", label: "Verloren", probability: 0, closed: "lost" },
  ],
};

describe("pipelineStats", () => {
  it("berechnet offene Pipeline, gewichteten Forecast und Abschlüsse", () => {
    const stats = pipelineStats(pipeline, [
      { stage: "neu", value: null }, // Standardwert 1000 → 100
      { stage: "angebot", value: 5000 }, // → 2500
      { stage: "won", value: 3000 },
      { stage: "lost", value: 9000 },
      { stage: "unbekannt", value: 7000 }, // wird ignoriert
    ]);
    expect(stats).toMatchObject({
      openCount: 2,
      openValue: 6000,
      weightedForecast: 2600,
      wonCount: 1,
      wonValue: 3000,
      lostCount: 1,
    });
    expect(stats.perStage.map((s) => s.count)).toEqual([1, 1, 1, 1]);
  });

  it("liefert für eine leere Pipeline Nullwerte", () => {
    expect(pipelineStats(pipeline, [])).toMatchObject({ openCount: 0, weightedForecast: 0, wonValue: 0 });
  });
});

describe("Konfiguration", () => {
  it.each(Object.values(funnels))("Funnel $id verweist auf existierende Pipeline und Stufen", (f) => {
    const p = pipelines[f.pipelineId];
    expect(p).toBeDefined();
    const ids = p.stages.map((s) => s.id);
    expect(ids).toContain(f.stageQualified);
    expect(ids).toContain(f.stageNotQualified);
  });
});
