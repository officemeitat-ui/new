import { getDatabase, withTenant } from "@nexus/db";
import { can, getPrivacySettings, listMembers, listSubprocessors } from "@nexus/domain";
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
import { FileText, Lock } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PrivacyPersons } from "@/components/privacy/privacy-persons";
import { RetentionForm } from "@/components/privacy/retention-form";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Datenschutz" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const t = await getTranslations("privacy");
  const ctx = await requireTenant();
  const canSettings = can(ctx.tenant, "tenant.settings.manage");
  const canMembers = can(ctx.tenant, "tenant.members.manage");
  if (!canSettings && !canMembers) {
    return (
      <EmptyState
        icon={<Lock aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenDescription")}
      />
    );
  }
  const tenantId = ctx.tenant.tenantId;
  const { settings, members } = await withTenant(getDatabase().db, tenantId, async (tx) => ({
    settings: await getPrivacySettings(tx, tenantId),
    members: await listMembers(tx, tenantId),
  }));
  const subprocessors = listSubprocessors();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("retentionTitle")}</CardTitle>
          <CardDescription>{t("retentionDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <RetentionForm
            canEdit={canSettings}
            chatRetentionDays={settings.chatRetentionDays}
            documentRetentionDays={settings.documentRetentionDays}
          />
        </CardContent>
      </Card>

      {canMembers ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("personsTitle")}</CardTitle>
            <CardDescription>{t("personsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <PrivacyPersons
              persons={members.map((member) => ({
                userId: member.userId,
                name: member.name,
                email: member.email,
                isSelf: member.userId === ctx.user.id,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("registerTitle")}</CardTitle>
          <CardDescription>{t("registerDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/settings/privacy/register">
              <FileText aria-hidden />
              {t("registerOpen")}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("subprocessorsTitle")}</CardTitle>
          <CardDescription>{t("subprocessorsDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {subprocessors.map((processor) => (
              <li key={processor.purpose} className="space-y-1 px-5 py-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {processor.name}
                  <Badge variant="secondary">{processor.location}</Badge>
                </p>
                <p className="text-muted-foreground">{processor.purpose}</p>
                {processor.note ? <p className="text-xs text-warning">{processor.note}</p> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
