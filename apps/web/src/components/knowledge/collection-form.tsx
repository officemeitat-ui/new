"use client";

import { Button, Card, CardContent, FieldError, Input, Label } from "@nexus/ui";
import { FolderPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { createCollectionAction } from "@/app/(app)/knowledge/actions";

export function CollectionForm() {
  const t = useTranslations("knowledge");
  const [state, action, pending] = useActionState(createCollectionAction, null);
  return (
    <Card>
      <CardContent className="pt-5">
        <form action={action} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="collection-name">{t("collectionName")}</Label>
            <Input
              id="collection-name"
              name="name"
              required
              minLength={2}
              maxLength={80}
              placeholder={t("collectionNamePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="collection-description">{t("collectionDescription")}</Label>
            <Input id="collection-description" name="description" maxLength={300} />
          </div>
          <Button type="submit" disabled={pending}>
            <FolderPlus aria-hidden />
            {t("newCollection")}
          </Button>
        </form>
        {state && !state.ok ? <FieldError className="mt-2">{state.error}</FieldError> : null}
      </CardContent>
    </Card>
  );
}
