import { getDatabase } from "@nexus/db";
import { findInvitationByToken, userExists } from "@nexus/domain";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nexus/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/app/actions/session";
import { AcceptInvitationButton } from "@/components/auth/accept-invitation-button";
import { InviteSignUpForm } from "@/components/auth/invite-sign-up-form";
import { getSessionUser } from "@/lib/session";

export const metadata = { title: "Einladung" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("invite");
  const db = getDatabase().db;
  const invitation = await findInvitationByToken(db, token);

  if (!invitation || invitation.status !== "valid") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("invalidTitle")}</CardTitle>
          <CardDescription>{t("invalidDescription")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const user = await getSessionUser();
  const header = (
    <CardHeader>
      <CardTitle className="text-xl">{t("title", { tenant: invitation.tenantName })}</CardTitle>
      <CardDescription>{t("description", { email: invitation.email })}</CardDescription>
    </CardHeader>
  );

  if (user) {
    if (user.email.toLowerCase() !== invitation.email) {
      return (
        <Card>
          {header}
          <CardContent className="space-y-4">
            <p className="text-sm">{t("wrongAccount", { email: user.email })}</p>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" className="w-full">
                {t("signOut")}
              </Button>
            </form>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        {header}
        <CardContent>
          <AcceptInvitationButton token={token} />
        </CardContent>
      </Card>
    );
  }

  if (await userExists(db, invitation.email)) {
    const next = encodeURIComponent(`/invite/${token}`);
    return (
      <Card>
        {header}
        <CardContent className="space-y-4">
          <p className="text-sm">{t("existingAccount")}</p>
          <Button asChild className="w-full">
            <Link href={`/login?next=${next}&email=${encodeURIComponent(invitation.email)}`}>
              {t("signInToAccept")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {header}
      <CardContent>
        <InviteSignUpForm token={token} email={invitation.email} />
      </CardContent>
    </Card>
  );
}
