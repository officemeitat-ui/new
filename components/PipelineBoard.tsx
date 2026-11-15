"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { moveLead } from "@/app/admin/actions";
import type { Stage } from "@/lib/pipeline";

export type BoardCard = {
  id: string;
  name: string;
  company: string | null;
  stage: string;
  score: number | null;
  qualified: boolean | null;
  /** Bereits formatierter Wert (oder null, wenn die Pipeline keine Werte führt). */
  value: string | null;
  createdAt: string;
};

export function PipelineBoard({ stages, cards }: { stages: Stage[]; cards: BoardCard[] }) {
  const [optimisticCards, applyMove] = useOptimistic(cards, (current, move: { id: string; stage: string }) =>
    current.map((card) => (card.id === move.id ? { ...card, stage: move.stage } : card)),
  );
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function move(id: string, stage: string) {
    setError(null);
    startTransition(async () => {
      applyMove({ id, stage });
      try {
        await moveLead(id, stage);
      } catch {
        setError("Verschieben fehlgeschlagen – bitte Seite neu laden.");
      }
    });
  }

  return (
    <>
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const column = optimisticCards.filter((c) => c.stage === stage.id);
          return (
            <section
              key={stage.id}
              aria-label={stage.label}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(stage.id);
              }}
              onDragLeave={() => setDragOver((s) => (s === stage.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id) move(id, stage.id);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-xl p-3 transition ${dragOver === stage.id ? "bg-brand-soft" : "bg-slate-200/60"}`}
            >
              <header className="mb-3 flex items-center justify-between px-1 text-sm">
                <span className="font-semibold">{stage.label}</span>
                <span className="text-slate-500">
                  {column.length} · {stage.probability} %
                </span>
              </header>
              <div className="flex min-h-24 flex-col gap-2">
                {column.map((card) => (
                  <article
                    key={card.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
                    className="cursor-grab rounded-lg bg-white p-3 text-sm shadow-sm active:cursor-grabbing"
                  >
                    <Link href={`/admin/leads/${card.id}`} className="font-semibold hover:text-brand">
                      {card.name}
                    </Link>
                    {card.company && <p className="text-slate-500">{card.company}</p>}
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                      {card.score === null ? (
                        <span />
                      ) : (
                        <span className={card.qualified ? "text-emerald-700" : "text-amber-700"}>Score {card.score}</span>
                      )}
                      {card.value && <span className="font-medium text-slate-700">{card.value}</span>}
                      <span>{card.createdAt}</span>
                    </div>
                    <label className="sr-only" htmlFor={`stage-${card.id}`}>
                      Stufe ändern
                    </label>
                    <select
                      id={`stage-${card.id}`}
                      value={card.stage}
                      onChange={(e) => move(card.id, e.target.value)}
                      className="mt-2 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
