"use client";

import { Button, FieldError, Label } from "@nexus/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { updateRetentionAction } from "@/app/(app)/settings/privacy/actions";

const OPTIONS = [30, 90, 180, 365, 730] as const;
const selectClass = "flex h-9 w-full rounded-md border bg-background px-3 text-sm";

export function RetentionForm({
  canEdit,
  chatRetentionDays,
  documentRetentionDays,
}: {
  canEdit: boolean;
  chatRetentionDays: number | null;
  documentRetentionDays: number | null;
}) {
  const t = useTranslations("privacy");
  const [state, action, pending] = useActionState(updateRetentionAction, null);
  const select = (name: string, value: number | null, label: string, hint: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={value === null ? "none" : String(value)}
        disabled={!canEdit}
        className={selectClass}
      >
        <option value="none">{t("keep")}</option>
        {OPTIONS.map((days) => (
          <option key={days} value={days}>
            {t("days", { days })}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {select("chatRetentionDays", chatRetentionDays, t("chats"), t("chatsHint"))}
        {select("documentRetentionDays", documentRetentionDays, t("documents"), t("documentsHint"))}
      </div>
      <p className="text-xs text-muted-foreground">{t("auditHint")}</p>
      {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
      {state?.ok ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}
      {canEdit ? (
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      ) : null}
    </form>
  );
}
