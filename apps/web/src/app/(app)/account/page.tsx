import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import { Download, ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { TwoFactorPanel } from "@/components/account/two-factor-panel";
import { getAppContext } from "@/lib/session";

export const metadata = { title: "Konto und Sicherheit" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ "2fa"?: string }>;
}) {
  const t = await getTranslations("account");
  // Not requireTenant(): this page must stay reachable while the 2FA policy blocks the rest.
  const { user, tenant } = await getAppContext();
  const required = (await searchParams)["2fa"] === "required" && !user.twoFactorEnabled;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {required ? (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <p>{t("requiredNotice")}</p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("profileTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{t("name")}</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted-foreground">{t("email")}</dt>
            <dd>{user.email}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("twoFactorTitle")}</CardTitle>
          <CardDescription>{t("twoFactorDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorPanel enabled={user.twoFactorEnabled} />
        </CardContent>
      </Card>

      {tenant ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("dataTitle")}</CardTitle>
            <CardDescription>{t("dataDescription", { tenant: tenant.tenantName })}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <a href="/api/privacy/export" download>
                <Download aria-hidden />
                {t("dataExport")}
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
