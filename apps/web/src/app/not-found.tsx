import { Button, EmptyState } from "@nexus/ui";
import { SearchX } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <EmptyState
        className="max-w-lg"
        icon={<SearchX aria-hidden />}
        title={t("notFoundTitle")}
        description={t("notFoundDescription")}
        action={
          <Button asChild>
            <Link href="/">{t("backToStart")}</Link>
          </Button>
        }
      />
    </main>
  );
}
