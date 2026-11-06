"use client";

import { Button, Card, CardContent, FieldError, Input, Label } from "@nexus/ui";
import { Check, Save } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { createArticleAction, updateArticleAction } from "@/app/(app)/knowledge/actions";

type Props =
  | { mode: "create"; collectionId: string }
  | {
      mode: "edit";
      collectionId: string;
      documentId: string;
      title: string;
      body: string;
      /** An agent's proposal: saving can accept it at the same time. */
      proposal: boolean;
      maxLength: number;
    };

/**
 * Title and Markdown text of an article or memory entry. Controlled fields, so a refused save
 * (e.g. duplicate) keeps what was typed.
 */
export function ArticleEditor(props: Props) {
  const t = useTranslations("knowledge");
  const [title, setTitle] = useState(props.mode === "edit" ? props.title : "");
  const [body, setBody] = useState(props.mode === "edit" ? props.body : "");
  const [state, action, pending] = useActionState(
    props.mode === "create"
      ? createArticleAction.bind(null, props.collectionId)
      : updateArticleAction.bind(null, props.documentId),
    null,
  );
  const proposal = props.mode === "edit" && props.proposal;
  return (
    <Card>
      <CardContent className="pt-5">
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="article-title">{t("articleTitle")}</Label>
            <Input
              id="article-title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              minLength={2}
              maxLength={200}
              placeholder={t("articleTitlePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="article-body">{t("articleBody")}</Label>
            <textarea
              id="article-body"
              name="body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
              rows={18}
              maxLength={props.mode === "edit" ? props.maxLength : 100_000}
              aria-describedby="article-body-hint"
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm leading-relaxed"
            />
            <p id="article-body-hint" className="text-xs text-muted-foreground">
              {t("articleBodyHint")}
            </p>
          </div>
          {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
          <div className="flex flex-wrap items-center gap-2">
            {proposal ? (
              <>
                <Button type="submit" name="intent" value="confirm" disabled={pending}>
                  <Check aria-hidden />
                  {t("articleSaveConfirm")}
                </Button>
                <Button
                  type="submit"
                  name="intent"
                  value="save"
                  variant="outline"
                  disabled={pending}
                >
                  <Save aria-hidden />
                  {t("articleSaveProposal")}
                </Button>
              </>
            ) : (
              <Button type="submit" disabled={pending}>
                <Save aria-hidden />
                {t("articleSave")}
              </Button>
            )}
            <Button asChild variant="ghost">
              <Link href={`/knowledge/${props.collectionId}`}>{t("articleCancel")}</Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
