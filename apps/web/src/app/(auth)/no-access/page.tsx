import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/app/actions/session";

export const metadata = { title: "Kein Zugriff" };

export default async function NoAccessPage() {
  const t = await getTranslations("noAccess");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" className="w-full">
            {t("signOut")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
