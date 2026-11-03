"use client";

import { Button, FieldError, Input, Label } from "@nexus/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { inviteMemberAction } from "@/app/(app)/settings/members/actions";

const selectClass = "flex h-9 w-full rounded-md border bg-background px-3 text-sm sm:w-40";

export function InviteForm({ roles }: { roles: { value: string; label: string }[] }) {
  const t = useTranslations("settings.members");
  const [state, action, pending] = useActionState(inviteMemberAction, null);

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="invite-email">{t("email")}</Label>
          <Input id="invite-email" name="email" type="email" required placeholder="name@firma.at" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-role">{t("role")}</Label>
          <select id="invite-role" name="role" defaultValue="member" className={selectClass}>
            {roles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          {t("invite")}
        </Button>
      </div>
      {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
      {state?.ok ? (
        <div role="status" className="space-y-1 text-sm text-success">
          <p>{state.message}</p>
          {state.data?.link ? (
            <code className="block break-all rounded bg-muted p-2 text-xs text-foreground">
              {state.data.link}
            </code>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
