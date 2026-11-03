"use client";

import { Button, FieldError } from "@nexus/ui";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { acceptInvitationAction } from "@/app/actions/session";

export function AcceptInvitationButton({ token }: { token: string }) {
  const t = useTranslations("invite");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await acceptInvitationAction(token);
            if (!result.ok) setError(result.error);
          })
        }
      >
        {t("accept")}
      </Button>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}
