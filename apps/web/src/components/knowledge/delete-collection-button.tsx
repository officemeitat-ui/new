"use client";

import { Button } from "@nexus/ui";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { deleteCollectionAction } from "@/app/(app)/knowledge/actions";

export function DeleteCollectionButton({
  collectionId,
  name,
}: {
  collectionId: string;
  name: string;
}) {
  const t = useTranslations("knowledge");
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(t("confirmDeleteCollection", { name }))) return;
        start(async () => {
          await deleteCollectionAction(collectionId);
        });
      }}
    >
      <Trash2 aria-hidden />
      {t("deleteCollection")}
    </Button>
  );
}
