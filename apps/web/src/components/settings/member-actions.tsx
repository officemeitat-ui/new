"use client";

import { Button } from "@nexus/ui";
import { Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  changeRoleAction,
  removeMemberAction,
  revokeInvitationAction,
} from "@/app/(app)/settings/members/actions";
import type { ActionResult } from "@/lib/actions";

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await fn();
      setError(result.ok ? null : result.error);
    });
  return { error, pending, run };
}

export function MemberActions({
  membershipId,
  role,
  roles,
  locked,
}: {
  membershipId: string;
  role: string;
  roles: { value: string; label: string }[];
  locked: boolean;
}) {
  const t = useTranslations("settings.members");
  const { error, pending, run } = useAction();
  const form = (extra: Record<string, string>) => {
    const data = new FormData();
    data.set("membershipId", membershipId);
    for (const [key, value] of Object.entries(extra)) data.set(key, value);
    return data;
  };

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label={t("role")}
        className="h-8 rounded-md border bg-background px-2 text-sm"
        defaultValue={role}
        disabled={pending || locked}
        onChange={(event) => run(() => changeRoleAction(form({ role: event.target.value })))}
      >
        {(locked ? [{ value: role, label: t("ownerLocked") }] : roles).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("remove")}
        disabled={pending || locked}
        onClick={() => {
          if (window.confirm(t("removeConfirm"))) run(() => removeMemberAction(form({})));
        }}
      >
        <Trash2 aria-hidden />
      </Button>
      {error ? (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const t = useTranslations("settings.members");
  const { error, pending, run } = useAction();
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          const data = new FormData();
          data.set("invitationId", invitationId);
          run(() => revokeInvitationAction(data));
        }}
      >
        <X aria-hidden />
        {t("revoke")}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}
