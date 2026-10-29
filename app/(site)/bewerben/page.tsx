import type { Metadata } from "next";
import { funnels, site } from "@/config/site";
import { FunnelForm } from "@/components/FunnelForm";
import { PlaceholderBadge } from "@/components/ui";
import { toPublicFunnel } from "@/lib/funnel";

const funnel = funnels.bewerbung;
const job = site.recruiting;

export const metadata: Metadata = { title: `${job.jobTitle} – ${funnel.title}` };

export default function BewerbenPage() {
  return (
    <div className="bg-gradient-to-b from-brand-soft to-white px-4 py-12 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <p className="text-sm font-medium text-brand">
            {job.company} · {job.location}
            <PlaceholderBadge show={job.placeholder} />
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{job.jobTitle}</h1>
          <p className="mt-3 text-slate-600">{funnel.intro}</p>
          <ul className="mt-6 flex flex-wrap justify-center gap-2">
            {job.benefits.map((benefit) => (
              <li key={benefit} className="rounded-full bg-white px-3 py-1 text-sm font-medium shadow-sm">
                {benefit}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-slate-500">{job.salary}</p>
        </div>
        <FunnelForm funnel={toPublicFunnel(funnel)} />
      </div>
    </div>
  );
}
