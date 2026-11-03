"use client";

import { Button, FieldError, Input, Label } from "@nexus/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { createTenantAction } from "@/app/(app)/partner/actions";

export function CreateTenantForm() {
  const t = useTranslations("partner");
  const tPlans = useTranslations("plans");
  const [state, action, pending] = useActionState(createTenantAction, null);

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="tenant-name">{t("name")}</Label>
          <Input id="tenant-name" name="name" required placeholder="Muster GmbH" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tenant-plan">{t("plan")}</Label>
          <select
            id="tenant-plan"
            name="plan"
            defaultValue="business"
            className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            {(["starter", "business", "enterprise"] as const).map((plan) => (
              <option key={plan} value={plan}>
                {tPlans(plan)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tenant-owner">{t("ownerEmail")}</Label>
          <Input
            id="tenant-owner"
            name="ownerEmail"
            type="email"
            required
            placeholder="chefin@firma.at"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {t("create")}
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
