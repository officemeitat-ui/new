"use client";

import { Button, FieldError, Input, Label } from "@nexus/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { updateGeneralAction } from "@/app/(app)/settings/general/actions";

export function GeneralForm({ name, hourlyRate }: { name: string; hourlyRate: string }) {
  const t = useTranslations("settings.general");
  const [state, action, pending] = useActionState(updateGeneralAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="tenant-name">{t("name")}</Label>
          <Input
            id="tenant-name"
            name="name"
            defaultValue={name}
            required
            minLength={2}
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="hourly-rate">{t("hourlyRate")}</Label>
          <Input
            id="hourly-rate"
            name="hourlyRate"
            inputMode="decimal"
            defaultValue={hourlyRate}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">{t("hourlyRateHint")}</p>
        </div>
      </div>
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
