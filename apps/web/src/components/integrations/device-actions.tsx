"use client";

import { Button } from "@nexus/ui";
import { Lock, RefreshCw, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { deviceActionAction } from "@/app/(app)/integrations/actions";

type Action = "sync" | "restart" | "lock";

export function DeviceActions({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const t = useTranslations("devices");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function run(action: Action) {
    if (action !== "sync" && !window.confirm(t(`confirm.${action}`, { name: deviceName }))) return;
    start(async () => {
      const response = await deviceActionAction({ deviceId, deviceName, action });
      setResult(
        response.ok
          ? { ok: true, text: response.message ?? "" }
          : { ok: false, text: response.error },
      );
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run("sync")}>
          <RefreshCw aria-hidden />
          {t("actions.sync")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run("restart")}
          aria-label={t("actions.restartFor", { name: deviceName })}
          title={t("actions.restart")}
        >
          <RotateCcw aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run("lock")}
          aria-label={t("actions.lockFor", { name: deviceName })}
          title={t("actions.lock")}
        >
          <Lock aria-hidden />
        </Button>
      </div>
      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={result.ok ? "text-xs text-success" : "text-xs text-danger"}
        >
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
