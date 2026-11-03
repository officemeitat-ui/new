"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldError,
  Input,
  Label,
} from "@nexus/ui";
import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

type Provider = "microsoft" | "google";

export function LoginForm({
  next,
  defaultEmail,
  providers,
}: {
  next: string;
  defaultEmail: string;
  providers: Provider[];
}) {
  const t = useTranslations("auth");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    setError(null);
    setPending(true);
    try {
      if (mode === "magic") {
        const { error: magicError } = await authClient.signIn.magicLink({
          email,
          callbackURL: next,
        });
        if (magicError) setError(t("magicLinkFailed"));
        else setMagicSent(true);
        return;
      }
      const { error: signInError } = await authClient.signIn.email({
        email,
        password: String(form.get("password") ?? ""),
      });
      if (signInError) {
        setError(signInError.status === 429 ? t("tooManyAttempts") : t("invalidCredentials"));
        return;
      }
      // Full navigation: the client router may hold a prefetched "redirect to /login" for the
      // target from before the sign-in, which would bounce the user back to this page.
      window.location.assign(next);
    } finally {
      setPending(false);
    }
  }

  if (magicSent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("magicLinkSentTitle")}</CardTitle>
          <CardDescription>{t("magicLinkSentDescription")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("loginTitle")}</CardTitle>
        <CardDescription>{t("loginDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={defaultEmail}
            />
          </div>
          {mode === "password" ? (
            <div className="space-y-2">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
          ) : null}
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {mode === "password" ? t("signIn") : t("sendMagicLink")}
          </Button>
        </form>

        <Button
          type="button"
          variant="link"
          className="h-auto w-full p-0"
          onClick={() => {
            setMode(mode === "password" ? "magic" : "password");
            setError(null);
          }}
        >
          <Mail aria-hidden />
          {mode === "password" ? t("useMagicLink") : t("usePassword")}
        </Button>

        {providers.length > 0 ? (
          <div className="space-y-2 border-t pt-4">
            {providers.map((provider) => (
              <Button
                key={provider}
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void authClient.signIn.social({ provider, callbackURL: next })}
              >
                {provider === "microsoft" ? t("signInMicrosoft") : t("signInGoogle")}
              </Button>
            ))}
          </div>
        ) : null}
        <p className="text-center text-xs text-muted-foreground">{t("noSelfSignup")}</p>
      </CardContent>
    </Card>
  );
}
