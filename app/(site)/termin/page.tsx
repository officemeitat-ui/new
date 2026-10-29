import type { Metadata } from "next";
import { funnels } from "@/config/site";
import { FunnelForm } from "@/components/FunnelForm";
import { toPublicFunnel } from "@/lib/funnel";

const funnel = funnels.erstgespraech;

export const metadata: Metadata = { title: funnel.title };

export default function TerminPage() {
  return (
    <div className="bg-gradient-to-b from-brand-soft to-white px-4 py-12 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{funnel.title}</h1>
          <p className="mt-3 text-slate-600">{funnel.intro}</p>
        </div>
        <FunnelForm funnel={toPublicFunnel(funnel)} />
      </div>
    </div>
  );
}
