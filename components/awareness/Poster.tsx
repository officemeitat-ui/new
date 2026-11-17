import { VERIFICATION_RULES } from "@/lib/awareness/content";

/** Einseiter STOPP · PRÜFEN · BESTÄTIGEN – zum Lesen und zum Aushängen (A4 drucken). */
export function Poster({ fill }: { fill: (text: string) => string }) {
  const rules = VERIFICATION_RULES;
  return (
    <article className="mx-auto max-w-3xl space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 print:p-0 print:shadow-none print:ring-0">
      <header className="rounded-xl bg-slate-900 p-5 text-white">
        <h1 className="text-2xl font-black tracking-wide">STOPP · PRÜFEN · BESTÄTIGEN</h1>
        <p className="mt-1 text-sm text-slate-300">{fill(rules.title)}</p>
      </header>
      <p className="text-sm whitespace-pre-line">{fill(rules.intro)}</p>
      <section>
        <h2 className="font-semibold">Wann gilt die Regel?</h2>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {rules.when.map((item) => (
            <li key={item}>{fill(item)}</li>
          ))}
        </ul>
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        {rules.steps.map((step, i) => (
          <div key={step.name} className={`rounded-xl p-4 ${["bg-red-50", "bg-amber-50", "bg-emerald-50"][i] ?? "bg-slate-50"}`}>
            <p className="font-black tracking-wide">{step.name}</p>
            <p className="mt-1 text-sm">{fill(step.text)}</p>
          </div>
        ))}
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <h2 className="font-semibold">Das gilt NICHT als Bestätigung</h2>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {rules.notValid.map((item) => (
              <li key={item}>{fill(item)}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-semibold">Rote Flaggen – sofort STOPP</h2>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {rules.redFlags.map((item) => (
              <li key={item}>{fill(item)}</li>
            ))}
          </ul>
        </div>
      </section>
      <p className="rounded-xl bg-slate-50 p-4 text-sm whitespace-pre-line italic">{fill(rules.backing)}</p>
      <section>
        <h2 className="font-semibold">Verdacht? Sofort melden!</h2>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rules.report.map((row) => (
            <div key={row.label} className="contents">
              <dt className="font-medium">{fill(row.label)}</dt>
              <dd>{fill(row.value)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </article>
  );
}
