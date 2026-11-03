"use client";

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
import { Check, Mail, MessagesSquare, Pencil, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import { decideApprovalAction } from "@/app/(app)/approvals/actions";

type Approval = {
  id: string;
  toolName: string;
  toolLabel: string;
  input: Record<string, unknown>;
  agentName: string;
  requestedByName: string | null;
  createdAt: string;
  conversationId: string;
};

type Email = { an: string[]; betreff: string; text: string };

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (value === null || value === undefined) return "–";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value as string | number | boolean);
}

function asEmail(input: Record<string, unknown>): Email | null {
  const { an, betreff, text } = input as Partial<Email>;
  return Array.isArray(an) && typeof betreff === "string" && typeof text === "string"
    ? { an, betreff, text }
    : null;
}

/**
 * The pending approvals plus a confirmation for each decision made here. The confirmation
 * stays when the server list refreshes and the decided approval drops out of it.
 */
export function ApprovalList({ approvals, empty }: { approvals: Approval[]; empty: ReactNode }) {
  const [decided, setDecided] = useState<{ id: string; text: string }[]>([]);
  const done = new Set(decided.map((d) => d.id));
  const open = approvals.filter((approval) => !done.has(approval.id));
  if (open.length === 0 && decided.length === 0) return empty;
  return (
    <div className="flex flex-col gap-4">
      {decided.map((d) => (
        <Card key={d.id}>
          <CardContent className="py-4">
            <p role="status" className="text-sm text-success">
              {d.text}
            </p>
          </CardContent>
        </Card>
      ))}
      {open.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          onDecided={(text) => setDecided((list) => [{ id: approval.id, text }, ...list])}
        />
      ))}
    </div>
  );
}

function ApprovalCard({
  approval,
  onDecided,
}: {
  approval: Approval;
  onDecided: (message: string) => void;
}) {
  const t = useTranslations("approvals");
  const email = asEmail(approval.input);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [draft, setDraft] = useState<Email | null>(email);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(approve: boolean) {
    startTransition(async () => {
      const edited =
        approve && editing && draft
          ? {
              an: draft.an.map((a) => a.trim()).filter(Boolean),
              betreff: draft.betreff,
              text: draft.text,
            }
          : null;
      const response = await decideApprovalAction({
        approvalId: approval.id,
        approve,
        editedInput: edited,
        reason: approve ? null : reason,
      });
      if (response.ok) onDecided(response.message ?? "");
      else setError(response.error);
    });
  }

  return (
    <Card data-testid="approval">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {email ? (
            <Mail className="size-4 text-muted-foreground" aria-hidden />
          ) : (
            <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
          )}
          {t("proposal", { agent: approval.agentName, tool: approval.toolLabel })}
        </CardTitle>
        <CardDescription>
          {t("requested", { name: approval.requestedByName ?? "–", date: approval.createdAt })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {email && draft ? (
          editing ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor={`to-${approval.id}`}>{t("to")}</Label>
                <Input
                  id={`to-${approval.id}`}
                  value={draft.an.join(", ")}
                  onChange={(e) => setDraft({ ...draft, an: e.target.value.split(",") })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`subject-${approval.id}`}>{t("subject")}</Label>
                <Input
                  id={`subject-${approval.id}`}
                  value={draft.betreff}
                  onChange={(e) => setDraft({ ...draft, betreff: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`text-${approval.id}`}>{t("text")}</Label>
                <textarea
                  id={`text-${approval.id}`}
                  value={draft.text}
                  rows={8}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          ) : (
            <dl className="space-y-2 rounded-md border bg-muted/40 p-4 text-sm">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-muted-foreground">{t("to")}</dt>
                <dd>{email.an.join(", ")}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-muted-foreground">{t("subject")}</dt>
                <dd className="font-medium">{email.betreff}</dd>
              </div>
              <div className="whitespace-pre-wrap border-t pt-3">{email.text}</div>
            </dl>
          )
        ) : (
          <dl className="space-y-2 rounded-md border bg-muted/40 p-4 text-sm">
            {Object.entries(approval.input).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">
                  {t.has(`fields.${key}`) ? t(`fields.${key}`) : key}
                </dt>
                <dd className={key.endsWith("_id") ? "font-mono text-xs" : "font-medium"}>
                  {formatValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {rejecting ? (
          <div className="space-y-1">
            <Label htmlFor={`reason-${approval.id}`}>{t("reason")}</Label>
            <Input
              id={`reason-${approval.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
            />
          </div>
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}

        <div className="flex flex-wrap gap-2">
          {rejecting ? (
            <>
              <Button variant="destructive" disabled={pending} onClick={() => decide(false)}>
                <X aria-hidden />
                {t("confirmReject")}
              </Button>
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                {t("cancel")}
              </Button>
            </>
          ) : (
            <>
              <Button disabled={pending} onClick={() => decide(true)}>
                <Check aria-hidden />
                {editing ? t("approveEdited") : t("approve")}
              </Button>
              {email && !editing ? (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden />
                  {t("edit")}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setRejecting(true)}>
                <X aria-hidden />
                {t("reject")}
              </Button>
              <Button asChild variant="ghost">
                <Link href={`/chat/${approval.conversationId}`}>
                  <MessagesSquare aria-hidden />
                  {t("openConversation")}
                </Link>
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
