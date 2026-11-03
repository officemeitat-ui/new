"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Input,
} from "@nexus/ui";
import { Clock, Plug, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { createBlankAgentAction, createFromTemplateAction } from "@/app/(app)/agents/actions";

type TemplateCard = {
  id: string;
  name: string;
  purpose: string;
  tier: string;
  roiMinutesPerTask: number;
  roiUnit: string;
  industries: string[];
  requiredIntegrations: string[];
};

const INDUSTRIES = [
  "handwerk",
  "steuerberatung",
  "immobilien",
  "handel",
  "agenturen",
  "industrie",
  "it",
] as const;

export function TemplateGallery({ templates }: { templates: TemplateCard[] }) {
  const t = useTranslations("agents");
  const tInt = useTranslations("integrations");
  const [industry, setIndustry] = useState<string | null>(null);
  const shown = industry
    ? templates.filter((template) => template.industries.includes(industry))
    : templates;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("industryFilter")}>
        {[null, ...INDUSTRIES].map((key) => (
          <button
            key={key ?? "all"}
            type="button"
            aria-pressed={industry === key}
            onClick={() => setIndustry(key)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              industry === key
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            {key ? t(`industries.${key}`) : t("allIndustries")}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((template) => (
          <Card key={template.id} className="flex flex-col">
            <CardHeader>
              <CardTitle>{template.name}</CardTitle>
              <CardDescription>{template.purpose}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto space-y-4">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="success">
                  <Clock className="size-3" aria-hidden />
                  {t("saves", { minutes: template.roiMinutesPerTask, unit: template.roiUnit })}
                </Badge>
                <Badge variant="secondary">{t(`tiers.${template.tier}`)}</Badge>
              </div>
              {template.requiredIntegrations.length > 0 ? (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Plug className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {t("needs", {
                    list: template.requiredIntegrations.map((key) => tInt(key)).join(", "),
                  })}
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <Sparkles className="size-3.5" aria-hidden />
                  {t("readyNow")}
                </p>
              )}
              <form action={createFromTemplateAction.bind(null, template.id)}>
                <Button
                  type="submit"
                  className="w-full"
                  aria-label={t("useTemplateFor", { name: template.name })}
                >
                  {t("useTemplate")}
                </Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("blankTitle")}</CardTitle>
          <CardDescription>{t("blankDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createBlankAgentAction} className="flex flex-col gap-2 sm:flex-row">
            <Input
              name="name"
              required
              minLength={2}
              placeholder={t("blankPlaceholder")}
              aria-label={t("blankName")}
              className="sm:max-w-sm"
            />
            <Button type="submit" variant="outline">
              {t("blankCreate")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
