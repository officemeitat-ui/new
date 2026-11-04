"use client";

import { modelDisplayName, resolveModel } from "@nexus/agents/models";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  FieldError,
  Input,
  Label,
} from "@nexus/ui";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  FileBadge,
  MessagesSquare,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState, useTransition } from "react";
import { saveAgentAction, setAgentStatusAction } from "@/app/(app)/agents/actions";

type Initial = {
  name: string;
  description: string;
  instructions: string;
  tier: string;
  effort: string;
  tools: Record<string, string>;
  maxSteps: number;
  maxCost: string;
  roiMinutes: string;
  knowledgeCollectionIds: string[];
};

const TIERS = ["smart", "balanced", "fast"] as const;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const PLACEHOLDER = /\{\{([a-z_.]+)\}\}/g;

const selectClass = "flex h-9 rounded-md border bg-background px-3 text-sm";

export function AgentEditor({
  agentId,
  isDefault,
  status,
  canPublish,
  currency,
  initial,
  catalog,
  collections,
  connected,
}: {
  agentId: string;
  isDefault: boolean;
  status: string;
  canPublish: boolean;
  currency: "EUR" | "USD";
  initial: Initial;
  catalog: { name: string; risk: string; available: boolean; requires?: string }[];
  /** Integrations this tenant has connected, e.g. microsoft365. */
  connected: string[];
  collections: { id: string; name: string; documents: number }[];
}) {
  const t = useTranslations("agents");
  const tTools = useTranslations("tools");
  const [instructions, setInstructions] = useState(initial.instructions);
  const [tier, setTier] = useState(initial.tier);
  const [state, action, pending] = useActionState(saveAgentAction.bind(null, agentId), null);
  const [statusPending, startStatus] = useTransition();
  const [statusError, setStatusError] = useState<string | null>(null);
  const open = useMemo(
    () => [...new Set([...instructions.matchAll(PLACEHOLDER)].map((m) => m[1]!))],
    [instructions],
  );

  return (
    <form action={action} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("sectionBasics")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="agent-name">{t("name")}</Label>
            <Input
              id="agent-name"
              name="name"
              defaultValue={initial.name}
              required
              minLength={2}
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-description">{t("description")}</Label>
            <Input
              id="agent-description"
              name="description"
              defaultValue={initial.description}
              maxLength={300}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionInstructions")}</CardTitle>
          <CardDescription>{t("instructionsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label htmlFor="agent-instructions" className="sr-only">
            {t("sectionInstructions")}
          </label>
          <textarea
            id="agent-instructions"
            name="instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={16}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed"
          />
          {open.length > 0 ? (
            <div role="note" className="flex gap-2 rounded-md bg-warning/10 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div className="space-y-1">
                <p>{t("openPlaceholders", { count: open.length })}</p>
                <p className="flex flex-wrap gap-1">
                  {open.map((name) => (
                    <code
                      key={name}
                      className="rounded bg-muted px-1.5 py-0.5 text-xs"
                    >{`{{${name}}}`}</code>
                  ))}
                </p>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionModel")}</CardTitle>
          <CardDescription>{t("modelHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="grid gap-3 sm:grid-cols-3"
            role="radiogroup"
            aria-label={t("sectionModel")}
          >
            {TIERS.map((key) => (
              <label
                key={key}
                className={cn(
                  "cursor-pointer rounded-lg border p-3 text-sm transition-colors",
                  tier === key ? "border-primary bg-accent/50" : "hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name="tier"
                  value={key}
                  checked={tier === key}
                  onChange={() => setTier(key)}
                  className="sr-only"
                />
                <span className="block font-medium">{t(`tiers.${key}`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {modelDisplayName(resolveModel(key))}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(`tierHints.${key}`)}
                </span>
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-effort">{t("effort")}</Label>
            <select
              id="agent-effort"
              name="effort"
              defaultValue={initial.effort}
              className={selectClass}
            >
              {EFFORTS.map((key) => (
                <option key={key} value={key}>
                  {t(`efforts.${key}`)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{t("effortHint")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionTools")}</CardTitle>
          <CardDescription>{t("toolsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {catalog.map((tool) => (
              <li key={tool.name} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {tTools(`${tool.name}.label`)}
                    {!tool.available ? <Badge variant="secondary">{t("toolSoon")}</Badge> : null}
                    {tool.risk === "external_write" ? (
                      <Badge variant="warning">{t("toolExternal")}</Badge>
                    ) : null}
                    {tool.risk === "destructive" ? (
                      <Badge variant="danger">{t("toolDestructive")}</Badge>
                    ) : null}
                    {tool.requires && !connected.includes(tool.requires) ? (
                      <Link href="/integrations">
                        <Badge variant="secondary">{t("toolNeedsMicrosoft")}</Badge>
                      </Link>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tTools(`${tool.name}.description`)}
                  </p>
                </div>
                <label className="sr-only" htmlFor={`tool-${tool.name}`}>
                  {tTools(`${tool.name}.label`)}
                </label>
                <select
                  id={`tool-${tool.name}`}
                  name={`tool:${tool.name}`}
                  defaultValue={initial.tools[tool.name] ?? "off"}
                  className={selectClass}
                >
                  <option value="off">{t("modeOff")}</option>
                  <option value="auto">{t("modeAuto")}</option>
                  <option value="approve">{t("modeApprove")}</option>
                </select>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionKnowledge")}</CardTitle>
          <CardDescription>{t("knowledgeHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {collections.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <BookOpen className="size-4" aria-hidden />
              {t("knowledgeNone")}{" "}
              <Link href="/knowledge" className="font-medium text-foreground underline">
                {t("knowledgeManage")}
              </Link>
            </p>
          ) : (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">{t("sectionKnowledge")}</legend>
              {collections.map((collection) => (
                <label
                  key={collection.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    name="knowledge"
                    value={collection.id}
                    defaultChecked={initial.knowledgeCollectionIds.includes(collection.id)}
                    className="size-4 accent-primary"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{collection.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("knowledgeDocuments", { count: collection.documents })}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sectionLimits")}</CardTitle>
          <CardDescription>{t("limitsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="agent-steps">{t("maxSteps")}</Label>
            <Input
              id="agent-steps"
              name="maxSteps"
              type="number"
              min={1}
              max={50}
              defaultValue={initial.maxSteps}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-cost">
              {t("maxCost", { currency: currency === "EUR" ? "€" : "$" })}
            </Label>
            <Input
              id="agent-cost"
              name="maxCost"
              inputMode="decimal"
              defaultValue={initial.maxCost}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-roi">{t("roiMinutes")}</Label>
            <Input
              id="agent-roi"
              name="roiMinutes"
              type="number"
              min={0}
              max={600}
              defaultValue={initial.roiMinutes}
            />
          </div>
        </CardContent>
      </Card>

      {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
      {state?.ok ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}
      {statusError ? <FieldError>{statusError}</FieldError> : null}

      <div className="flex flex-wrap gap-2">
        {canPublish ? (
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href={`/chat?agent=${agentId}`}>
            <MessagesSquare aria-hidden />
            {t("testInChat")}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/agents/${agentId}/steckbrief`}>
            <FileBadge aria-hidden />
            {t("profile")}
          </Link>
        </Button>
        {!isDefault ? (
          <Button
            type="button"
            variant="ghost"
            disabled={statusPending}
            onClick={() =>
              startStatus(async () => {
                const result = await setAgentStatusAction(
                  agentId,
                  status === "archived" ? "active" : "archived",
                );
                setStatusError(result.ok ? null : result.error);
              })
            }
          >
            {status === "archived" ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {status === "archived" ? t("unarchive") : t("archive")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
