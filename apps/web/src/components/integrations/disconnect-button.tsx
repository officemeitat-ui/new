"use client";

import { Button, FieldError } from "@nexus/ui";
import { Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { disconnectMicrosoftAction } from "@/app/(app)/integrations/actions";

export function DisconnectButton() {
  const t = useTranslations("integrationsPage");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(t("confirmDisconnect"))) return;
          start(async () => {
            const result = await disconnectMicrosoftAction();
            setError(result.ok ? null : result.error);
          });
        }}
      >
        <Unplug aria-hidden />
        {t("disconnect")}
      </Button>
      {error ? <FieldError>{error}</FieldError> : null}
    </>
  );
}
