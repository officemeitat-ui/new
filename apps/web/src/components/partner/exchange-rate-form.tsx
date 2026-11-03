"use client";

import { Button, FieldError, Input, Label } from "@nexus/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { updateExchangeRateAction } from "@/app/(app)/partner/actions";

export function ExchangeRateForm({ rate }: { rate: number | null }) {
  const t = useTranslations("partner");
  const [state, action, pending] = useActionState(updateExchangeRateAction, null);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="usd-eur-rate">{t("rateLabel")}</Label>
          <Input
            id="usd-eur-rate"
            name="usdEurRate"
            inputMode="decimal"
            defaultValue={rate === null ? "" : String(rate).replace(".", ",")}
            placeholder="0,92"
            className="w-32 tabular-nums"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {t("rateSave")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("rateHint")}</p>
      {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
      {state?.ok ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
