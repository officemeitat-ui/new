"use client";

import Link from "next/link";
import { useState } from "react";
import type { ContactFieldId, PublicFunnel } from "@/lib/funnel";
import { readTrackingSource } from "@/components/TrackingCapture";

type Result = { qualified: boolean; title: string; text: string; bookingUrl: string | null };

export function FunnelForm({ funnel }: { funnel: PublicFunnel }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const totalSteps = funnel.questions.length + 1;
  const question = funnel.questions[step];

  function choose(questionId: string, optionId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    setStep((s) => Math.min(s + 1, funnel.questions.length));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const contact: Partial<Record<ContactFieldId, string>> = {};
    for (const field of funnel.contactFields) {
      const value = String(form.get(field.id) ?? "").trim();
      if (value) contact[field.id] = value;
    }

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          funnel: funnel.id,
          answers,
          contact,
          consent: form.get("consent") === "on",
          website: form.get("website"),
          source: readTrackingSource(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Senden fehlgeschlagen");
      setResult(data);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Senden fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-lg sm:p-10">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-2xl text-brand">✓</div>
          <h2 className="mt-4 text-2xl font-bold">{result.title}</h2>
          <p className="mx-auto mt-2 max-w-lg text-slate-600">{result.text}</p>
        </div>
        {result.bookingUrl && (
          <div className="mt-8">
            <iframe src={result.bookingUrl} title="Termin buchen" className="h-[700px] w-full rounded-xl border border-slate-200" />
            <p className="mt-3 text-center text-sm text-slate-500">
              Kalender wird nicht angezeigt?{" "}
              <a href={result.bookingUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline">
                In neuem Tab öffnen
              </a>
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-lg sm:p-10">
      <div className="mb-8">
        <div className="flex justify-between text-sm text-slate-500">
          <span>
            Schritt {step + 1} von {totalSteps}
          </span>
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="font-medium text-brand hover:underline">
              ← Zurück
            </button>
          )}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${((step + 1) / totalSteps) * 100}%` }} />
        </div>
      </div>

      {question ? (
        <fieldset key={question.id}>
          <legend className="text-xl font-bold sm:text-2xl">{question.title}</legend>
          {question.hint && <p className="mt-1 text-slate-500">{question.hint}</p>}
          <div className="mt-6 grid gap-3">
            {question.options.map((option) => {
              const selected = answers[question.id] === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => choose(question.id, option.id)}
                  aria-pressed={selected}
                  className={`rounded-xl border-2 px-5 py-4 text-left font-medium transition hover:border-brand hover:bg-brand-soft ${
                    selected ? "border-brand bg-brand-soft" : "border-slate-200"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <h2 className="text-xl font-bold sm:text-2xl">Fast geschafft – wie erreichen wir Sie?</h2>
          {funnel.contactFields.map((field) => (
            <label key={field.id} className="block">
              <span className="text-sm font-medium">
                {field.label}
                {!field.required && <span className="font-normal text-slate-400"> (optional)</span>}
              </span>
              {field.type === "textarea" ? (
                <textarea
                  name={field.id}
                  required={field.required}
                  maxLength={2000}
                  rows={4}
                  placeholder={field.placeholder}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 focus:border-brand focus:outline-none"
                />
              ) : (
                <input
                  name={field.id}
                  type={field.type}
                  required={field.required}
                  maxLength={field.type === "url" ? 500 : 200}
                  placeholder={field.placeholder}
                  autoComplete={
                    { name: "name", email: "email", phone: "tel", company: "organization", link: "url", message: "off" }[field.id]
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 focus:border-brand focus:outline-none"
                />
              )}
            </label>
          ))}
          {/* Honeypot gegen Spam-Bots – für Menschen unsichtbar */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
          <label className="flex gap-3 text-sm text-slate-600">
            <input type="checkbox" name="consent" required className="mt-1 h-4 w-4 accent-brand" />
            <span>
              Ich bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage gespeichert und verarbeitet werden. Details in der{" "}
              <Link href="/datenschutz" target="_blank" className="text-brand underline">
                Datenschutzerklärung
              </Link>
              .
            </span>
          </label>
          {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand px-6 py-4 text-lg font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {submitting ? "Wird gesendet …" : "Absenden"}
          </button>
        </form>
      )}
    </div>
  );
}
