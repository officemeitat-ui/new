"use client";

import { Button, FieldError, Input, Label } from "@nexus/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { acceptInvitationAction } from "@/app/actions/session";
import { authClient } from "@/lib/auth-client";

const MIN_PASSWORD = 10;

export function InviteSignUpForm({ token, email }: { token: string; email: string }) {
  const t = useTranslations("invite");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (password.length < MIN_PASSWORD) {
      setError(t("passwordTooShort", { min: MIN_PASSWORD }));
      return;
    }
    if (password !== String(form.get("passwordConfirm") ?? "")) {
      setError(t("passwordMismatch"));
      return;
    }
    setError(null);
    setPending(true);
    try {
      const { error: signUpError } = await authClient.signUp.email({ email, password, name });
      if (signUpError) {
        setError(signUpError.status === 429 ? t("tooManyAttempts") : t("signUpFailed"));
        return;
      }
      const result = await acceptInvitationAction(token);
      if (!result.ok) setError(result.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" autoComplete="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="passwordConfirm">{t("passwordConfirm")}</Label>
        <Input
          id="passwordConfirm"
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {t("createAccount")}
      </Button>
    </form>
  );
}
