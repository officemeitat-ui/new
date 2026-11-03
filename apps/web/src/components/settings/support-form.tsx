"use client";

import { Button, FieldError, Input, Label } from "@nexus/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import { grantSupportAction, revokeSupportAction } from "@/app/(app)/settings/support/actions";

const HOURS = [1, 4, 24, 72] as const;

export function SupportGrantForm() {
  const t = useTranslations("settings.support");
  const [state, action, pending] = useActionState(grantSupportAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="support-reason">{t("reason")}</Label>
          <Input
            id="support-reason"
            name="reason"
            required
            minLength={3}
            maxLength={500}
            placeholder={t("reasonPlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="support-hours">{t("duration")}</Label>
          <select
            id="support-hours"
            name="hours"
            defaultValue="4"
            className="flex h-9 rounded-md border bg-background px-3 text-sm"
          >
            {HOURS.map((hours) => (
              <option key={hours} value={hours}>
                {t("hours", { count: hours })}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          {t("grant")}
        </Button>
      </div>
      {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
      {state?.ok ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function RevokeSupportButton({ grantId }: { grantId: string }) {
  const t = useTranslations("settings.support");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const data = new FormData();
            data.set("grantId", grantId);
            const result = await revokeSupportAction(data);
            if (!result.ok) setError(result.error);
          })
        }
      >
        {t("revoke")}
      </Button>
      {error ? <FieldError className="w-full">{error}</FieldError> : null}
    </>
  );
}
