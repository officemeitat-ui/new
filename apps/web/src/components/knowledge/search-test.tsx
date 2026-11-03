"use client";

import type { KnowledgeHit } from "@nexus/domain";
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
import { Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment, useState, useTransition, type FormEvent } from "react";
import { searchKnowledgeAction } from "@/app/(app)/knowledge/actions";

/** Renders the **…** marks from ts_headline as <mark>, everything else as plain text. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="rounded-sm bg-warning/25 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function SearchTest({ collectionId }: { collectionId: string }) {
  const t = useTranslations("knowledge");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    start(async () => {
      const result = await searchKnowledgeAction(collectionId, query);
      if (result.ok) {
        setHits(result.data ?? []);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("searchTitle")}</CardTitle>
        <CardDescription>{t("searchHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="knowledge-search">{t("searchLabel")}</Label>
            <Input
              id="knowledge-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
            />
          </div>
          <Button type="submit" variant="outline" disabled={pending || !query.trim()}>
            <Search aria-hidden />
            {t("search")}
          </Button>
        </form>
        {error ? <FieldError>{error}</FieldError> : null}
        {hits ? (
          hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noHits")}</p>
          ) : (
            <ol className="space-y-3" aria-label={t("hitsLabel")}>
              {hits.map((hit) => (
                <li key={hit.chunkId} className="rounded-md border p-3 text-sm">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    <Link
                      href={`/knowledge/documents/${hit.documentId}`}
                      className="hover:underline"
                    >
                      {hit.documentTitle}
                    </Link>
                    {hit.page ? ` · ${t("page", { page: hit.page })}` : ""}
                    {hit.heading ? ` · ${hit.heading}` : ""}
                  </p>
                  <p className="leading-relaxed">
                    <Snippet text={hit.snippet} />
                  </p>
                </li>
              ))}
            </ol>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
