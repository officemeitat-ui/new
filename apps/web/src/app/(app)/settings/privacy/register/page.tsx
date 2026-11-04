import { formatDateTime } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, getProcessingRegister } from "@nexus/domain";
import { EmptyState } from "@nexus/ui";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PrintButton } from "@/components/privacy/print-button";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Verarbeitungsverzeichnis" };
export const dynamic = "force-dynamic";

/** Record of processing activities (Art. 30 DSGVO) as a template to complete and print. */
export default async function RegisterPage() {
  const t = await getTranslations("privacy");
  const ctx = await requireTenant();
  if (!can(ctx.tenant, "tenant.settings.manage")) {
    return (
      <EmptyState
        icon={<Lock aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenDescription")}
      />
    );
  }
  const register = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    getProcessingRegister(tx, ctx.tenant.tenantId),
  );
  const rows: [string, keyof (typeof register.activities)[number]][] = [
    [t("register.purpose"), "purpose"],
    [t("register.legalBasis"), "legalBasis"],
    [t("register.subjects"), "subjects"],
    [t("register.data"), "data"],
    [t("register.recipients"), "recipients"],
    [t("register.retention"), "retention"],
  ];

  return (
    <article className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Link
          href="/settings/privacy"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Link>
        <PrintButton label={t("print")} />
      </div>
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">{t("register.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("register.controller", { name: ctx.tenant.tenantName })} ·{" "}
          {t("register.created", { date: formatDateTime(new Date()) })}
        </p>
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          {t("register.draftNote")}
        </p>
      </header>

      {register.activities.map((activity, index) => (
        <section key={activity.title} className="break-inside-avoid rounded-lg border p-4">
          <h3 className="mb-3 font-semibold">
            {index + 1}. {activity.title}
          </h3>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
            {rows.map(([label, key]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{activity[key]}</dd>
              </div>
            ))}
            <dt className="text-muted-foreground">{t("register.toms")}</dt>
            <dd>{t("register.tomsText")}</dd>
          </dl>
        </section>
      ))}

      <section className="break-inside-avoid rounded-lg border p-4">
        <h3 className="mb-3 font-semibold">{t("subprocessorsTitle")}</h3>
        <ul className="space-y-2 text-sm">
          {register.subprocessors.map((processor) => (
            <li key={processor.purpose}>
              <span className="font-medium">{processor.name}</span> – {processor.purpose} (
              {processor.location}){processor.note ? ` – ${processor.note}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
