import { formatDateTime } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, listAuditEntries, verifyAuditChain } from "@nexus/domain";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@nexus/ui";
import { Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Audit-Log" };

const KNOWN_ACTIONS = new Set([
  "tenant.created",
  "invitation.created",
  "invitation.accepted",
  "invitation.revoked",
  "member.added",
  "member.removed",
  "member.role_changed",
]);

export default async function AuditPage() {
  const t = await getTranslations("settings.audit");
  const ctx = await requireTenant();
  if (!can(ctx.tenant, "tenant.audit.read")) {
    return (
      <EmptyState
        icon={<Lock aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenDescription")}
      />
    );
  }

  const { entries, chain } = await withTenant(
    getDatabase().db,
    ctx.tenant.tenantId,
    async (tx) => ({
      entries: await listAuditEntries(tx, ctx.tenant.tenantId),
      chain: await verifyAuditChain(tx, ctx.tenant.tenantId),
    }),
  );

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        {chain.valid ? (
          <Badge variant="success">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("chainValid", { count: chain.count })}
          </Badge>
        ) : (
          <Badge variant="danger">
            <ShieldAlert className="size-3.5" aria-hidden />
            {t("chainBroken", { seq: chain.brokenAtSeq })}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {entries.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ol className="divide-y">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3 text-sm"
              >
                <span className="w-36 shrink-0 tabular-nums text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                </span>
                <span className="flex-1 font-medium">
                  {KNOWN_ACTIONS.has(entry.action)
                    ? t(`actions.${entry.action.replace(".", "_")}`)
                    : entry.action}
                </span>
                <span className="text-muted-foreground">
                  {entry.actorName ?? t(`actors.${entry.actorType}`)}
                </span>
                <span className="w-10 text-right tabular-nums text-muted-foreground">
                  #{entry.seq}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
