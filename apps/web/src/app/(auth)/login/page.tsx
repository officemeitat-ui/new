import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { enabledSocialProviders } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirect";
import { getSessionUser } from "@/lib/session";

export const metadata = { title: "Anmelden" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const { next, email } = await searchParams;
  const target = safeNextPath(next);
  if (await getSessionUser()) redirect(target);
  return <LoginForm next={target} defaultEmail={email ?? ""} providers={enabledSocialProviders} />;
}
