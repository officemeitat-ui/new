"use client";

import { Button, EmptyState } from "@nexus/ui";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      className="mx-auto max-w-xl"
      icon={<TriangleAlert aria-hidden />}
      title={t("unexpectedTitle")}
      description={t("unexpectedDescription")}
      action={<Button onClick={reset}>{t("retry")}</Button>}
    />
  );
}
