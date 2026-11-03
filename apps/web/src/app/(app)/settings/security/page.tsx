import { getDatabase, withTenant } from "@nexus/db";
import { can, listMembers } from "@nexus/domain";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@nexus/ui";
import { Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SecurityForm } from "@/components/settings/security-form";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Sicherheit" };

export default async function SecurityPage() {
  const t = await getTranslations("settings.security");
  const tRoles = await getTranslations("roles");
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
  const members = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    listMembers(tx, ctx.tenant.tenantId),
  );
  const admins = members.filter((m) => m.role !== "member");

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SecurityForm
            requireAdminTwoFactor={ctx.tenant.requireAdminTwoFactor}
            actorHasTwoFactor={ctx.user.twoFactorEnabled}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("adminsTitle")}</CardTitle>
          <CardDescription>{t("adminsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {admins.map((admin) => (
              <li key={admin.membershipId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{admin.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{admin.email}</p>
                </div>
                <Badge variant="secondary">{tRoles(admin.role)}</Badge>
                {admin.twoFactorEnabled ? (
                  <Badge variant="success">{t("twoFactorOn")}</Badge>
                ) : (
                  <Badge variant="warning">{t("twoFactorOff")}</Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
