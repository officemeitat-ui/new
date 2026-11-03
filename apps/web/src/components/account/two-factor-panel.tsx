"use client";

import { Badge, Button, FieldError, Input, Label } from "@nexus/ui";
import { Download, ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

type Action = "enable" | "disable" | "backup";
type Setup = { qr: string; secret: string; backupCodes: string[] };

function downloadCodes(codes: string[]) {
  const blob = new Blob([`${codes.join("\n")}\n`], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "backup-codes.txt";
  link.click();
  URL.revokeObjectURL(url);
}

function BackupCodes({ codes }: { codes: string[] }) {
  const t = useTranslations("account");
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("backupCodesTitle")}</p>
      <p className="text-sm text-muted-foreground">{t("backupCodesHint")}</p>
      <ul
        className="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-sm sm:grid-cols-5"
        aria-label={t("backupCodesTitle")}
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => downloadCodes(codes)}>
        <Download aria-hidden />
        {t("downloadCodes")}
      </Button>
    </div>
  );
}

export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const t = useTranslations("account");
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setPending(true);
    try {
      await fn();
    } finally {
      setPending(false);
    }
  }

  function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    void run(async () => {
      if (action === "enable") {
        const { data, error: apiError } = await authClient.twoFactor.enable({ password });
        if (apiError || !data || !("totpURI" in data) || !data.totpURI) {
          setError(t("wrongPassword"));
          return;
        }
        const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
        setSetup({
          qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 192 }),
          secret,
          backupCodes: data.backupCodes ?? [],
        });
      } else if (action === "disable") {
        const { error: apiError } = await authClient.twoFactor.disable({ password });
        if (apiError) {
          setError(t("wrongPassword"));
          return;
        }
        setAction(null);
        router.refresh();
      } else if (action === "backup") {
        const { data, error: apiError } = await authClient.twoFactor.generateBackupCodes({
          password,
        });
        if (apiError || !data) {
          setError(t("wrongPassword"));
          return;
        }
        setNewCodes(data.backupCodes);
        setAction(null);
      }
    });
  }

  function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    void run(async () => {
      const { error: apiError } = await authClient.twoFactor.verifyTotp({ code });
      if (apiError) {
        setError(t("wrongCode"));
        return;
      }
      setSetup(null);
      setAction(null);
      router.refresh();
    });
  }

  if (setup) {
    return (
      <div className="space-y-6">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>{t("setupStep1")}</li>
          <li>{t("setupStep2")}</li>
          <li>{t("setupStep3")}</li>
        </ol>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <img
            src={setup.qr}
            alt={t("qrAlt")}
            width={192}
            height={192}
            className="rounded-md border bg-white"
          />
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">{t("manualKey")}</p>
            <code
              data-testid="totp-secret"
              className="block break-all rounded bg-muted px-2 py-1 font-mono"
            >
              {setup.secret}
            </code>
          </div>
        </div>
        <BackupCodes codes={setup.backupCodes} />
        <form onSubmit={onVerify} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="totp-code">{t("codeLabel")}</Label>
            <Input
              id="totp-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              required
              className="w-40 font-mono"
            />
          </div>
          <Button type="submit" disabled={pending}>
            {t("confirmSetup")}
          </Button>
        </form>
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {enabled ? (
          <Badge variant="success">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t("statusOn")}
          </Badge>
        ) : (
          <Badge variant="warning">
            <ShieldOff className="size-3.5" aria-hidden />
            {t("statusOff")}
          </Badge>
        )}
      </div>

      {newCodes ? <BackupCodes codes={newCodes} /> : null}

      {action ? (
        <form onSubmit={onPassword} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{t("passwordLabel")}</Label>
            <Input
              id="confirm-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-64"
            />
          </div>
          <Button
            type="submit"
            disabled={pending}
            variant={action === "disable" ? "destructive" : "default"}
          >
            {t(`continue_${action}`)}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAction(null)}>
            {t("cancel")}
          </Button>
        </form>
      ) : enabled ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAction("backup")}>
            {t("newBackupCodes")}
          </Button>
          <Button variant="outline" onClick={() => setAction("disable")}>
            {t("disable")}
          </Button>
        </div>
      ) : (
        <Button onClick={() => setAction("enable")}>{t("enable")}</Button>
      )}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}
