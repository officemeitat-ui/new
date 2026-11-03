"use client";

import { Button, FieldError } from "@nexus/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { updateSecurityAction } from "@/app/(app)/settings/security/actions";

export function SecurityForm({
  requireAdminTwoFactor,
  actorHasTwoFactor,
}: {
  requireAdminTwoFactor: boolean;
  actorHasTwoFactor: boolean;
}) {
  const t = useTranslations("settings.security");
  const [state, action, pending] = useActionState(updateSecurityAction, null);
  return (
    <form action={action} className="space-y-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="requireAdminTwoFactor"
          defaultChecked={requireAdminTwoFactor}
          className="mt-0.5 size-4"
        />
        <span className="space-y-1">
          <span className="block text-sm font-medium">{t("requireLabel")}</span>
          <span className="block text-sm text-muted-foreground">{t("requireHint")}</span>
        </span>
      </label>
      {!actorHasTwoFactor ? <p className="text-sm text-warning">{t("selfHint")}</p> : null}
      {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
      {state?.ok ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
    </form>
  );
}
