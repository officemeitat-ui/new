import { getDatabase, withTenant } from "@nexus/db";
import { can, listFacilities } from "@nexus/domain";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@nexus/ui";
import { ArrowLeft, Lock, QrCode } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FacilityForm, FacilityToggle } from "@/components/reports/facility-form";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Objekte" };
export const dynamic = "force-dynamic";

export default async function FacilitiesPage() {
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
  const list = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    listFacilities(tx, ctx.tenant.tenantId),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="space-y-3">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("newTitle")}</CardTitle>
          <CardDescription>{t("newDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FacilityForm />
        </CardContent>
      </Card>

      {list.length === 0 ? null : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {list.map((facility) => (
                <li
                  key={facility.id}
                  data-testid="facility"
                  className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {facility.name}
                      {!facility.active ? <Badge variant="secondary">{t("inactive")}</Badge> : null}
                      {facility.openReports > 0 ? (
                        <Badge variant="danger">{t("open", { count: facility.openReports })}</Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        facility.address,
                        facility.contactEmail
                          ? t("notifies", { email: facility.contactEmail })
                          : t("noContact"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/reports/objects/${facility.id}`}>
                      <QrCode aria-hidden />
                      {t("poster")}
                    </Link>
                  </Button>
                  <FacilityToggle facilityId={facility.id} active={facility.active} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
