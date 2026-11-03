import { formatDateTime } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { approvalScopeFor, can, listApprovals } from "@nexus/domain";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@nexus/ui";
import { CheckCheck, Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ApprovalList } from "@/components/approvals/approval-card";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Freigaben" };
export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const t = await getTranslations("approvals");
  const tTools = await getTranslations("tools");
  const ctx = await requireTenant();
  if (!can(ctx.tenant, "approval.decide")) {
    return (
      <EmptyState
        icon={<Lock aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenDescription")}
      />
    );
  }
  const scope = approvalScopeFor(ctx.tenant);
  const { pending, decided } = await withTenant(
    getDatabase().db,
    ctx.tenant.tenantId,
    async (tx) => ({
      pending: await listApprovals(tx, ctx.tenant.tenantId, "pending", scope),
      decided: await listApprovals(tx, ctx.tenant.tenantId, "decided", scope),
    }),
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <ApprovalList
        empty={
          <EmptyState
            icon={<CheckCheck aria-hidden />}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        }
        approvals={pending.map((approval) => ({
          id: approval.id,
          toolName: approval.toolName,
          toolLabel: tTools.has(`${approval.toolName}.label`)
            ? tTools(`${approval.toolName}.label`)
            : approval.toolName,
          input: approval.input,
          agentName: approval.agentName,
          requestedByName: approval.requestedByName,
          createdAt: formatDateTime(approval.createdAt),
          conversationId: approval.conversationId,
        }))}
      />

      {decided.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("historyTitle")}</CardTitle>
            <CardDescription>{t("historyDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {decided.map((approval) => (
                <li
                  key={approval.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{approval.agentName}</span> ·{" "}
                    {tTools.has(`${approval.toolName}.label`)
                      ? tTools(`${approval.toolName}.label`)
                      : approval.toolName}
                    {approval.reason ? (
                      <span className="text-muted-foreground"> – {approval.reason}</span>
                    ) : null}
                  </span>
                  <Badge variant={approval.status === "approved" ? "success" : "danger"}>
                    {approval.status === "approved"
                      ? t(approval.editedInput ? "approvedEdited" : "approved")
                      : t("rejected")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {approval.decidedByName} ·{" "}
                    {approval.decidedAt ? formatDateTime(approval.decidedAt) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
