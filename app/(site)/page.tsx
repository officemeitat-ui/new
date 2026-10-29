import { site } from "@/config/site";
import { ButtonLink, PlaceholderBadge, Section } from "@/components/ui";

export default function HomePage() {
  const { hero, problems, process, testimonials, faq, finalCta } = site;

  return (
    <>
      <section className="bg-gradient-to-b from-brand-soft to-white px-4 pt-16 pb-20 sm:pt-24">
        <div className="mx-auto max-w-4xl text-center">
          <p className="mb-4 inline-block rounded-full bg-white px-4 py-1 text-sm font-medium text-brand shadow-sm">
            {hero.eyebrow}
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight text-balance sm:text-6xl">{hero.title}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-slate-600">{hero.subtitle}</p>
          <div className="mt-10 flex flex-col items-center gap-3">
            <ButtonLink href="/termin" className="px-8 py-4 text-lg">
              {hero.cta} →
            </ButtonLink>
            <p className="text-sm text-slate-500">{hero.ctaHint}</p>
          </div>
          <ul className="mx-auto mt-12 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
            {hero.bullets.map((bullet) => (
              <li key={bullet} className="flex gap-2 rounded-lg bg-white p-4 text-sm font-medium shadow-sm">
                <span className="text-brand">✓</span>
                {bullet}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Section>
        <h2 className="text-center text-3xl font-bold tracking-tight">{problems.title}</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {problems.items.map((item) => (
            <div key={item.title} className="rounded-xl border border-slate-200 p-6">
              <h3 className="text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-slate-600">{item.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="prozess" className="bg-slate-50">
        <h2 className="text-center text-3xl font-bold tracking-tight">{process.title}</h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {process.steps.map((step, index) => (
            <li key={step.title} className="rounded-xl bg-white p-6 shadow-sm">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-lg font-bold text-white">
                {index + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-slate-600">{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <h2 className="text-center text-3xl font-bold tracking-tight">{testimonials.title}</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {testimonials.items.map((item, index) => (
            <figure key={index} className="flex flex-col rounded-xl border border-slate-200 p-6">
              <blockquote className="flex-1 text-slate-700">„{item.quote}“</blockquote>
              <figcaption className="mt-4 text-sm">
                <span className="font-semibold">{item.name}</span>
                <PlaceholderBadge show={item.placeholder} />
                <br />
                <span className="text-slate-500">{item.role}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section id="faq" className="bg-slate-50">
        <h2 className="text-center text-3xl font-bold tracking-tight">{faq.title}</h2>
        <div className="mx-auto mt-10 max-w-3xl divide-y divide-slate-200 rounded-xl bg-white shadow-sm">
          {faq.items.map((item) => (
            <details key={item.q} className="group p-6">
              <summary className="flex cursor-pointer list-none items-center justify-between font-semibold">
                {item.q}
                <span className="ml-4 text-brand transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section>
        <div className="rounded-2xl bg-brand px-6 py-12 text-center text-white sm:px-12">
          <h2 className="text-3xl font-bold tracking-tight">{finalCta.title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-white/85">{finalCta.text}</p>
          <ButtonLink href="/termin" variant="inverted" className="mt-8">
            {hero.cta} →
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
