import { isUuid } from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import { getDatabase, withTenant } from "@nexus/db";
import { can, getFacility } from "@nexus/domain";
import { EmptyState } from "@nexus/ui";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { PrintButton } from "@/components/privacy/print-button";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "QR-Aushang" };
export const dynamic = "force-dynamic";

/** Printable notice for the object: QR code and short instructions. */
export default async function FacilityPosterPage({
  params,
}: {
  params: Promise<{ facilityId: string }>;
}) {
  const { facilityId } = await params;
  if (!isUuid(facilityId)) notFound();
  const t = await getTranslations("facilities");
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
  const facility = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    getFacility(tx, ctx.tenant.tenantId, facilityId).catch(() => null),
  );
  if (!facility) notFound();
  const url = `${getEnv().APP_URL}/m/${facility.publicToken}`;
  // Generated server-side from our own URL: safe to inline.
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/reports/objects"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("backToObjects")}
        </Link>
        <PrintButton label={t("print")} />
      </div>
      <article className="flex flex-col items-center gap-5 rounded-xl border p-8 text-center print:border-0">
        <h1 className="text-3xl font-bold tracking-tight">{t("posterHeadline")}</h1>
        <p className="text-lg">{t("posterText")}</p>
        <div
          className="w-64 max-w-full rounded-lg bg-white p-3"
          data-testid="qr"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <p className="text-lg font-semibold">{facility.name}</p>
        <p className="text-sm text-muted-foreground">{t("posterNoLogin")}</p>
        <p className="break-all font-mono text-xs text-muted-foreground">{url}</p>
      </article>
    </div>
  );
}
