"use client";

import { Button, FieldError, Input, Label } from "@nexus/ui";
import { contrastRatio, generatePalette, type ThemeTokens } from "@nexus/ui/palette";
import { Check, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";
import { updateBrandingAction } from "@/app/(app)/settings/branding/actions";

const PRESETS = [
  "#2454d6",
  "#0f766e",
  "#15803d",
  "#b45309",
  "#c2410c",
  "#e30613",
  "#7c3aed",
  "#334155",
];
const HEX = /^#[0-9a-fA-F]{6}$/;

function Preview({
  theme,
  label,
  productName,
}: {
  theme: ThemeTokens;
  label: string;
  productName: string;
}) {
  const t = useTranslations("settings.branding");
  return (
    <div
      className="flex-1 rounded-lg border p-4"
      style={{ background: theme.background, color: theme.foreground, borderColor: theme.border }}
    >
      <p className="mb-3 text-xs font-medium" style={{ color: theme.mutedForeground }}>
        {label}
      </p>
      <div className="mb-3 flex items-center gap-2 font-semibold">
        <span
          className="flex size-6 items-center justify-center rounded-md"
          style={{ background: theme.primary, color: theme.primaryForeground }}
        >
          <Sparkles className="size-3.5" aria-hidden />
        </span>
        {productName}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-md px-3 py-1.5 text-sm font-medium"
          style={{ background: theme.primary, color: theme.primaryForeground }}
        >
          {t("previewButton")}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ background: theme.accent, color: theme.accentForeground }}
        >
          {t("previewBadge")}
        </span>
        <span className="text-sm underline" style={{ color: theme.primary }}>
          {t("previewLink")}
        </span>
      </div>
    </div>
  );
}

export function BrandingForm({
  current,
  ownColor,
  partnerColor,
  productName,
}: {
  current: string;
  ownColor: string | null;
  partnerColor: string;
  productName: string;
}) {
  const t = useTranslations("settings.branding");
  const [color, setColor] = useState(current);
  const [state, action, pending] = useActionState(updateBrandingAction, null);
  const valid = HEX.test(color);
  const palette = useMemo(() => (valid ? generatePalette(color) : null), [color, valid]);
  const adjusted = palette && palette.light.primary.toLowerCase() !== color.toLowerCase();

  return (
    <form action={action} className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="brand-color">{t("color")}</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={t("colorPicker")}
              value={valid ? color : partnerColor}
              onChange={(event) => setColor(event.target.value)}
              className="h-9 w-12 cursor-pointer rounded-md border bg-background p-1"
            />
            <Input
              id="brand-color"
              name="color"
              value={color}
              onChange={(event) => setColor(event.target.value.trim())}
              aria-invalid={!valid}
              className="w-32 font-mono"
              maxLength={7}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("presets")}>
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setColor(preset)}
              aria-label={preset}
              aria-pressed={color.toLowerCase() === preset}
              className="flex size-8 items-center justify-center rounded-full border-2 border-transparent aria-pressed:border-foreground"
              style={{ background: preset }}
            >
              {color.toLowerCase() === preset ? (
                <Check className="size-4 text-white" aria-hidden />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {palette ? (
        <div className="space-y-2">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Preview theme={palette.light} label={t("previewLight")} productName={productName} />
            <Preview theme={palette.dark} label={t("previewDark")} productName={productName} />
          </div>
          <p className="text-sm text-muted-foreground">
            {adjusted
              ? t("adjusted", { color: palette.light.primary })
              : t("contrastOk", {
                  ratio: contrastRatio(
                    palette.light.primary,
                    palette.light.primaryForeground,
                  ).toFixed(1),
                })}
          </p>
        </div>
      ) : (
        <FieldError>{t("invalid")}</FieldError>
      )}

      {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
      {state?.ok ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="save" disabled={!valid || pending}>
          {t("save")}
        </Button>
        {ownColor ? (
          <Button type="submit" name="intent" value="reset" variant="outline" disabled={pending}>
            {t("reset", { color: partnerColor })}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
