"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldError,
} from "@nexus/ui";
import { Check, Lightbulb, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { confirmProposalAction, rejectProposalAction } from "@/app/(app)/knowledge/actions";

type Proposal = {
  id: string;
  title: string;
  text: string;
  /** Already formatted (de-AT) on the server. */
  proposed: string;
  proposedByName: string | null;
};

/**
 * Entries agents proposed for the company memory. Nothing here is searchable until a person
 * accepts it (memory poisoning protection, ADR 0011).
 */
export function MemoryProposals({ proposals }: { proposals: Proposal[] }) {
  const t = useTranslations("knowledge");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (proposals.length === 0 && !message) return null;

  const run = (proposal: Proposal, kind: "accept" | "reject") =>
    start(async () => {
      const result =
        kind === "accept"
          ? await confirmProposalAction(proposal.id)
          : await rejectProposalAction(proposal.id);
      setMessage(
        result.ok
          ? {
              ok: true,
              text: t(kind === "accept" ? "accepted" : "rejected", { name: proposal.title }),
            }
          : { ok: false, text: result.error },
      );
    });

  return (
    <Card data-testid="memory-proposals" className="border-warning/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="size-5 text-warning" aria-hidden />
          {t("proposalsTitle")}
          {proposals.length ? (
            <span className="text-sm font-normal text-muted-foreground">
              ({t("proposalsCount", { count: proposals.length })})
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>{t("proposalsHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {message ? (
          message.ok ? (
            <p role="status" className="text-sm text-success">
              {message.text}
            </p>
          ) : (
            <FieldError>{message.text}</FieldError>
          )
        ) : null}
        <ul className="space-y-3">
          {proposals.map((proposal) => (
            <li
              key={proposal.id}
              data-testid="memory-proposal"
              className="space-y-2 rounded-md border p-3"
            >
              <p className="font-medium">{proposal.title}</p>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm">
                {proposal.text}
              </p>
              <p className="text-xs text-muted-foreground">
                {proposal.proposedByName
                  ? t("proposalMetaBy", { date: proposal.proposed, name: proposal.proposedByName })
                  : t("proposalMeta", { date: proposal.proposed })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pending}
                  aria-label={t("acceptNamed", { name: proposal.title })}
                  onClick={() => run(proposal, "accept")}
                >
                  <Check aria-hidden />
                  {t("accept")}
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`/knowledge/documents/${proposal.id}/edit`}
                    aria-label={t("editNamed", { name: proposal.title })}
                  >
                    <Pencil aria-hidden />
                    {t("edit")}
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-label={t("rejectNamed", { name: proposal.title })}
                  onClick={() => {
                    if (!window.confirm(t("confirmReject", { name: proposal.title }))) return;
                    run(proposal, "reject");
                  }}
                >
                  <X aria-hidden />
                  {t("reject")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
