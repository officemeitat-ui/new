"use client";

import { Button, FieldError, Input, Label } from "@nexus/ui";
import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useTransition } from "react";
import { createFacilityAction, setFacilityActiveAction } from "@/app/(app)/reports/actions";

export function FacilityForm() {
  const t = useTranslations("facilities");
  const [state, action, pending] = useActionState(createFacilityAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3 sm:items-end">
      <div className="space-y-1.5">
        <Label htmlFor="facility-name">{t("name")}</Label>
        <Input
          id="facility-name"
          name="name"
          required
          minLength={2}
          maxLength={120}
          placeholder={t("namePlaceholder")}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="facility-address">{t("address")}</Label>
        <Input id="facility-address" name="address" maxLength={300} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="facility-contact">{t("contact")}</Label>
        <Input id="facility-contact" name="contactEmail" type="email" maxLength={200} />
      </div>
      <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Building2 aria-hidden />
          {t("create")}
        </Button>
        {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
        {state?.ok ? (
          <p role="status" className="text-sm text-success">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function FacilityToggle({ facilityId, active }: { facilityId: string; active: boolean }) {
  const t = useTranslations("facilities");
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => start(async () => void (await setFacilityActiveAction(facilityId, !active)))}
    >
      {active ? t("deactivate") : t("activate")}
    </Button>
  );
}
