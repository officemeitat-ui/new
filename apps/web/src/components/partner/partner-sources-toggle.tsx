"use client";

import { Button } from "@nexus/ui";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { setPartnerSourcesAction } from "@/app/(app)/partner/actions";

/** Partner admins allow a company to connect BookStack and Atera. */
export function PartnerSourcesToggle({
  tenantId,
  tenantName,
  allowed,
}: {
  tenantId: string;
  tenantName: string;
  allowed: boolean;
}) {
  const t = useTranslations("partner");
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={allowed ? "secondary" : "ghost"}
      disabled={pending}
      aria-pressed={allowed}
      aria-label={t("sourcesToggleLabel", { name: tenantName })}
      onClick={() => {
        if (!allowed && !window.confirm(t("sourcesConfirm", { name: tenantName }))) return;
        start(async () => void (await setPartnerSourcesAction(tenantId, !allowed)));
      }}
    >
      {allowed ? t("sourcesAllowed") : t("sourcesOff")}
    </Button>
  );
}
