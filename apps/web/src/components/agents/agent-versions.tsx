"use client";

import { Button, Card, CardContent, CardHeader, CardTitle, FieldError } from "@nexus/ui";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { restoreVersionAction } from "@/app/(app)/agents/actions";

export function AgentVersions({
  agentId,
  currentVersionId,
  canPublish,
  versions,
}: {
  agentId: string;
  currentVersionId: string;
  canPublish: boolean;
  versions: { id: string; version: number; createdAt: string; createdByName: string | null }[];
}) {
  const t = useTranslations("agents");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="size-4" aria-hidden />
          {t("versionsTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3 text-sm">
          {versions.map((version) => (
            <li key={version.id} className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">
                  {t("version", { version: version.version })}
                  {version.id === currentVersionId ? (
                    <span className="text-success"> · {t("current")}</span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {version.createdAt}
                  {version.createdByName ? ` · ${version.createdByName}` : ""}
                </p>
              </div>
              {canPublish && version.id !== currentVersionId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await restoreVersionAction(agentId, version.id);
                      setMessage(
                        result.ok
                          ? { ok: true, text: result.message ?? "" }
                          : { ok: false, text: result.error },
                      );
                    })
                  }
                >
                  {t("restore")}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
        {message ? (
          message.ok ? (
            <p role="status" className="mt-3 text-sm text-success">
              {message.text}
            </p>
          ) : (
            <FieldError className="mt-3">{message.text}</FieldError>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
