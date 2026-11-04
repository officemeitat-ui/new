import { getDatabase } from "@nexus/db";
import { findFacilityByToken } from "@nexus/domain";
import { Card, CardContent, CardDescription, CardHeader } from "@nexus/ui";
import { getTranslations } from "next-intl/server";
import { ReportForm } from "@/components/reports/report-form";

export const metadata = { title: "Mangel melden", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Public page behind a facility's QR code – no login, no personal data required. */
export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("report");
  const facility = await findFacilityByToken(getDatabase().db, token);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-4 py-8">
      {facility ? (
        <Card>
          <CardHeader>
            <p className="text-sm text-muted-foreground">{facility.tenantName}</p>
            <h1 className="text-xl font-semibold leading-tight">
              {t("title", { facility: facility.name })}
            </h1>
            <CardDescription>{t("intro")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReportForm token={token} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <h1 className="text-base font-semibold leading-tight">{t("invalidTitle")}</h1>
            <CardDescription>{t("invalidDescription")}</CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  );
}
