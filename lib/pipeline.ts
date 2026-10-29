// Pipeline-Stufen und Forecast-Berechnung.

export type Stage = {
  id: string;
  label: string;
  /** Abschlusswahrscheinlichkeit in Prozent – Grundlage des gewichteten Forecasts. */
  probability: number;
  closed?: "won" | "lost";
};

export type Pipeline = {
  id: string;
  label: string;
  /** Bezeichnung eines Eintrags, z. B. „Lead“ oder „Bewerbung“. */
  itemLabel: string;
  stages: Stage[];
  /** Deal-Werte erfassen und Forecast anzeigen (für Vertrieb ja, für Recruiting nein). */
  trackValue: boolean;
  /** Angenommener Deal-Wert in EUR, solange kein Wert gepflegt ist. */
  defaultValue: number;
};

export type PipelineItem = { stage: string; value: number | null };

export type StageStats = { stage: Stage; count: number; value: number };

export type PipelineStats = {
  perStage: StageStats[];
  openCount: number;
  /** Summe der Deal-Werte aller offenen Einträge. */
  openValue: number;
  /** Offene Deal-Werte gewichtet mit der Wahrscheinlichkeit ihrer Stufe. */
  weightedForecast: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
};

export function itemValue(pipeline: Pipeline, item: PipelineItem): number {
  return item.value ?? pipeline.defaultValue;
}

export function findStage(pipeline: Pipeline, stageId: string): Stage | undefined {
  return pipeline.stages.find((s) => s.id === stageId);
}

export function pipelineStats(pipeline: Pipeline, items: PipelineItem[]): PipelineStats {
  const perStage = pipeline.stages.map((stage) => ({ stage, count: 0, value: 0 }));
  const stats: PipelineStats = {
    perStage,
    openCount: 0,
    openValue: 0,
    weightedForecast: 0,
    wonCount: 0,
    wonValue: 0,
    lostCount: 0,
  };

  for (const item of items) {
    const entry = perStage.find((s) => s.stage.id === item.stage);
    if (!entry) continue;
    const value = itemValue(pipeline, item);
    entry.count += 1;
    entry.value += value;

    if (entry.stage.closed === "won") {
      stats.wonCount += 1;
      stats.wonValue += value;
    } else if (entry.stage.closed === "lost") {
      stats.lostCount += 1;
    } else {
      stats.openCount += 1;
      stats.openValue += value;
      stats.weightedForecast += (value * entry.stage.probability) / 100;
    }
  }

  stats.weightedForecast = Math.round(stats.weightedForecast);
  return stats;
}
