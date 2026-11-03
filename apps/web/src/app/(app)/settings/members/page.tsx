import { formatDate, SYSTEM_TENANT_ROLES } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { can, listMembers, listPendingInvitations } from "@nexus/domain";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import { getTranslations } from "next-intl/server";
import { InviteForm } from "@/components/settings/invite-form";
import { MemberActions, RevokeInvitationButton } from "@/components/settings/member-actions";
import { requireTenant } from "@/lib/session";

export const metadata = { title: "Mitglieder" };

export default async function MembersPage() {
  const t = await getTranslations("settings.members");
  const tRoles = await getTranslations("roles");
  const ctx = await requireTenant();
  const canManage = can(ctx.tenant, "tenant.members.manage");
  const { members, invitations } = await withTenant(
    getDatabase().db,
    ctx.tenant.tenantId,
    async (tx) => ({
      members: await listMembers(tx, ctx.tenant.tenantId),
      invitations: canManage ? await listPendingInvitations(tx, ctx.tenant.tenantId) : [],
    }),
  );
  const roleOptions = SYSTEM_TENANT_ROLES.filter(
    (role) => ctx.tenant.role === "owner" || role !== "owner",
  ).map((role) => ({ value: role, label: tRoles(role) }));

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("inviteTitle")}</CardTitle>
            <CardDescription>{t("inviteDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm roles={roleOptions} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle", { count: members.length })}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {members.map((member) => (
              <li key={member.membershipId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {member.name}
                    {member.userId === ctx.user.id ? (
                      <span className="text-muted-foreground"> · {t("you")}</span>
                    ) : null}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                </div>
                <span className="hidden text-sm text-muted-foreground sm:block">
                  {t("since", { date: formatDate(member.createdAt) })}
                </span>
                {canManage && member.userId !== ctx.user.id ? (
                  <MemberActions
                    membershipId={member.membershipId}
                    role={member.role}
                    roles={roleOptions}
                    locked={member.role === "owner" && ctx.tenant.role !== "owner"}
                  />
                ) : (
                  <Badge variant={member.role === "owner" ? "accent" : "secondary"}>
                    {tRoles(member.role)}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {invitations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("pendingTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{invitation.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("expires", { date: formatDate(invitation.expiresAt) })}
                    </p>
                  </div>
                  <Badge variant="secondary">{tRoles(invitation.role)}</Badge>
                  <RevokeInvitationButton invitationId={invitation.id} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
