"use client";

import { useState } from "react";
import type { AwarenessScenario } from "@/lib/awareness/content";

const CHOICES: { id: AwarenessScenario["verdict"] | "harmlos"; label: string }[] = [
  { id: "angriff", label: "Angriff" },
  { id: "verdacht", label: "Verdächtig – wie einen Angriff behandeln" },
  { id: "verstoss", label: "Verstoß gegen unsere Regeln" },
  { id: "harmlos", label: "Harmlos" },
];

/** Übung „Echt oder Angriff?“: Situation lesen, einschätzen, Auflösung sehen. */
export function Exercise({ scenarios, children }: { scenarios: AwarenessScenario[]; children: React.ReactNode }) {
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const finished = index >= scenarios.length;
  if (finished) {
    return (
      <div className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold">Geschafft!</h2>
        <p className="text-sm text-slate-600">
          {score} von {scenarios.length} Situationen richtig eingeschätzt. Merke: Im Zweifel immer wie einen Angriff behandeln – nachfragen
          kostet eine Minute, ein Fehler oft viel mehr.
        </p>
        {children}
      </div>
    );
  }
  const scenario = scenarios[index];
  const right = choice !== null && (choice === scenario.verdict || (scenario.verdict === "verdacht" && choice === "angriff"));
  return (
    <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Situation {index + 1} von {scenarios.length}
      </p>
      <p className="text-base leading-relaxed">{scenario.situation}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={choice !== null}
            onClick={() => {
              setChoice(c.id);
              if (c.id === scenario.verdict || (scenario.verdict === "verdacht" && c.id === "angriff")) setScore((s) => s + 1);
            }}
            className={`rounded-xl px-4 py-3 text-left text-sm font-medium ring-1 ${
              choice === null
                ? "bg-white ring-slate-300 hover:ring-emerald-500"
                : c.id === scenario.verdict
                  ? "bg-emerald-50 ring-emerald-500"
                  : choice === c.id
                    ? "bg-red-50 ring-red-400"
                    : "bg-white opacity-50 ring-slate-200"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {choice !== null && (
        <div
          className={`space-y-1 rounded-xl px-4 py-3 text-sm ${right ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-950"}`}
        >
          <p className="font-semibold">
            {right ? "Richtig. " : "Nicht ganz. "}
            {scenario.answer}
          </p>
          <p>{scenario.explanation}</p>
          <button
            type="button"
            onClick={() => {
              setIndex(index + 1);
              setChoice(null);
            }}
            className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            {index + 1 < scenarios.length ? "Nächste Situation" : "Abschließen"}
          </button>
        </div>
      )}
    </div>
  );
}
