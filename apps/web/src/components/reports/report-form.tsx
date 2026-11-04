"use client";

import { Button, FieldError, Input, Label } from "@nexus/ui";
import { CheckCircle2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { submitReportAction, type ReportState } from "@/app/(public)/m/[token]/actions";

const CATEGORIES = ["verschmutzung", "nachfuellen", "schaden", "sonstiges"] as const;

export function ReportForm({ token }: { token: string }) {
  const t = useTranslations("report");
  const [state, action, pending] = useActionState<ReportState, FormData>(
    submitReportAction.bind(null, token),
    null,
  );
  if (state?.ok) {
    return (
      <p role="status" className="flex items-start gap-2 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        {t("thanks")}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("category")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((category, index) => (
            <label
              key={category}
              className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/50"
            >
              <input
                type="radio"
                name="category"
                value={category}
                defaultChecked={index === 0}
                className="accent-primary"
              />
              {t(`categories.${category}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="report-location">{t("location")}</Label>
        <Input
          id="report-location"
          name="location"
          maxLength={120}
          placeholder={t("locationPlaceholder")}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="report-description">{t("description")}</Label>
        <textarea
          id="report-description"
          name="description"
          required
          minLength={3}
          maxLength={1000}
          rows={4}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="report-email">{t("email")}</Label>
        <Input id="report-email" name="email" type="email" maxLength={200} autoComplete="email" />
        <p className="text-xs text-muted-foreground">{t("emailHint")}</p>
      </div>
      {/* Bot trap: hidden from people and screen readers. */}
      <div aria-hidden className="hidden">
        <label>
          Website <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
      <Button type="submit" disabled={pending} className="w-full">
        <Send aria-hidden />
        {t("submit")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("privacy")}</p>
    </form>
  );
}
