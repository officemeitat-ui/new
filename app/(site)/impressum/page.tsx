import type { Metadata } from "next";
import { site } from "@/config/site";
import { PlaceholderBadge, Section } from "@/components/ui";

export const metadata: Metadata = { title: "Impressum" };

export default function ImpressumPage() {
  const { legal } = site;
  return (
    <Section>
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold">
          Impressum
          <PlaceholderBadge show={legal.placeholder} />
        </h1>
        <p className="mt-2 text-sm text-slate-500">Informationspflicht laut § 5 ECG, § 14 UGB und Offenlegung laut § 25 MedienG.</p>
        <dl className="mt-8 space-y-4">
          {[
            ["Unternehmen", legal.company],
            ["Anschrift", legal.address],
            ["E-Mail", legal.email],
            ["Telefon", legal.phone],
            ["Firmenbuch", legal.register],
            ["UID-Nummer", legal.vatId],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm font-medium text-slate-500">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
