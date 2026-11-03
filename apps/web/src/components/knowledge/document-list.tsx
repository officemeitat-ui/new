"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, FieldError } from "@nexus/ui";
import { FileText, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { deleteDocumentAction } from "@/app/(app)/knowledge/actions";

type Document = {
  id: string;
  title: string;
  fileName: string;
  kind: string;
  sizeBytes: number;
  status: string;
  error: string | null;
  pageCount: number | null;
  chunkCount: number;
  uploaded: string;
};

const STATUS_VARIANT = { processing: "warning", ready: "success", failed: "danger" } as const;

export function DocumentList({
  collectionId,
  documents,
  canManage,
}: {
  collectionId: string;
  documents: Document[];
  canManage: boolean;
}) {
  const t = useTranslations("knowledge");
  const format = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const processing = documents.some((d) => d.status === "processing");

  // While the worker extracts text, look for the result every two seconds.
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => router.refresh(), 2_000);
    return () => clearInterval(timer);
  }, [processing, router]);

  const size = (bytes: number) =>
    bytes < 1024 * 1024
      ? format.number(Math.max(1, Math.round(bytes / 1024)), { style: "unit", unit: "kilobyte" })
      : format.number(bytes / 1024 / 1024, {
          style: "unit",
          unit: "megabyte",
          maximumFractionDigits: 1,
        });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("documentsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {documents.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{t("documentsEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {documents.map((document) => {
              const status = (
                document.status in STATUS_VARIANT ? document.status : "processing"
              ) as keyof typeof STATUS_VARIANT;
              return (
                <li
                  key={document.id}
                  data-testid="document"
                  className="flex flex-wrap items-center gap-3 px-5 py-3"
                >
                  <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {status === "ready" ? (
                        <Link
                          href={`/knowledge/documents/${document.id}`}
                          className="hover:underline"
                        >
                          {document.title}
                        </Link>
                      ) : (
                        document.title
                      )}
                      <Badge variant={STATUS_VARIANT[status]}>
                        {status === "processing" ? (
                          <Loader2 className="size-3 animate-spin" aria-hidden />
                        ) : null}
                        {t(`status.${status}`)}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        t(`kinds.${document.kind}`),
                        size(document.sizeBytes),
                        document.pageCount ? t("pages", { count: document.pageCount }) : null,
                        status === "ready" ? t("chunks", { count: document.chunkCount }) : null,
                        document.uploaded,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {status === "failed" && document.error ? (
                      <p className="text-xs text-danger">{document.error}</p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      aria-label={t("deleteDocument", { name: document.title })}
                      onClick={() => {
                        if (!window.confirm(t("confirmDeleteDocument", { name: document.title })))
                          return;
                        start(async () => {
                          const result = await deleteDocumentAction(collectionId, document.id);
                          setError(result.ok ? null : result.error);
                        });
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {error ? <FieldError className="px-5 pb-4">{error}</FieldError> : null}
      </CardContent>
    </Card>
  );
}
