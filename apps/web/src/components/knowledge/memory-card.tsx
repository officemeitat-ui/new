"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldError,
} from "@nexus/ui";
import { Brain } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { openMemoryAction } from "@/app/(app)/knowledge/actions";

/** Shown until the company memory exists: explains it and creates it on request. */
export function MemoryCard() {
  const t = useTranslations("knowledge");
  const [state, action, pending] = useActionState(openMemoryAction, null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="size-5 text-primary" aria-hidden />
          {t("memoryTitle")}
        </CardTitle>
        <CardDescription>{t("memoryText")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action}>
          <Button type="submit" variant="outline" disabled={pending}>
            {t("memoryCreate")}
          </Button>
        </form>
        {state && !state.ok ? <FieldError className="mt-2">{state.error}</FieldError> : null}
      </CardContent>
    </Card>
  );
}
