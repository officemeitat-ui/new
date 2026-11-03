"use client";

import { ACCEPT } from "@nexus/knowledge/detect";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  FieldError,
} from "@nexus/ui";
import { FileUp, Loader2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useRef, useState, type DragEvent } from "react";
import { uploadDocumentsAction } from "@/app/(app)/knowledge/actions";

/** File picker with drag and drop; dropped files go into the real file input of the form. */
export function UploadForm({ collectionId }: { collectionId: string }) {
  const t = useTranslations("knowledge");
  const [names, setNames] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // React resets the form after the action; the list of chosen names follows it.
  const [state, action, pending] = useActionState(
    async (previous: Awaited<ReturnType<typeof uploadDocumentsAction>> | null, data: FormData) => {
      const result = await uploadDocumentsAction(collectionId, previous, data);
      setNames([]);
      return result;
    },
    null,
  );

  const pick = (files: FileList | null) => setNames(files ? [...files].map((f) => f.name) : []);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!input.current || event.dataTransfer.files.length === 0) return;
    input.current.files = event.dataTransfer.files;
    pick(event.dataTransfer.files);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("uploadTitle")}</CardTitle>
        <CardDescription>{t("uploadHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={action} className="space-y-3">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors",
              dragging ? "border-primary bg-accent/40" : "border-border",
            )}
          >
            <FileUp className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-muted-foreground">{t("dropHint")}</p>
            <label
              htmlFor="knowledge-files"
              className="cursor-pointer rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-muted focus-within:outline-2 focus-within:outline-ring"
            >
              {t("chooseFiles")}
            </label>
            <input
              ref={input}
              id="knowledge-files"
              name="files"
              type="file"
              multiple
              required
              accept={ACCEPT}
              onChange={(event) => pick(event.target.files)}
              className="sr-only"
            />
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {names.length === 0 ? t("noFiles") : names.join(", ")}
            </p>
          </div>
          <Button type="submit" disabled={pending || names.length === 0}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            {pending ? t("uploading") : t("upload")}
          </Button>
        </form>
        {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
        {state?.ok ? (
          <p role="status" className="text-sm text-success">
            {state.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
