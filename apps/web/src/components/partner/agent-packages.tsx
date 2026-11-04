"use client";

import { Badge, Button, FieldError, Input, Label } from "@nexus/ui";
import { PackagePlus, Rocket, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";
import {
  createAgentPackageAction,
  rolloutAgentPackageAction,
  updateAgentPackageAction,
} from "@/app/(app)/partner/agents/actions";

function Status({ state }: { state: { ok: boolean; message?: string; error?: string } | null }) {
  if (!state) return null;
  return state.ok ? (
    state.message ? (
      <p role="status" className="text-sm text-success">
        {state.message}
      </p>
    ) : null
  ) : (
    <FieldError>{state.error}</FieldError>
  );
}

export function CreatePackageForm({ templates }: { templates: { id: string; name: string }[] }) {
  const t = useTranslations("agentPackages");
  const [state, action, pending] = useActionState(createAgentPackageAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="package-template">{t("template")}</Label>
          <select
            id="package-template"
            name="templateId"
            defaultValue="angebote"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          <PackagePlus aria-hidden />
          {t("create")}
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function PackageEditor({
  pkg,
}: {
  pkg: { id: string; name: string; description: string; instructions: string };
}) {
  const t = useTranslations("agentPackages");
  const [state, action, pending] = useActionState(
    updateAgentPackageAction.bind(null, pkg.id),
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`package-name-${pkg.id}`}>{t("name")}</Label>
          <Input
            id={`package-name-${pkg.id}`}
            name="name"
            defaultValue={pkg.name}
            required
            minLength={2}
            maxLength={80}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`package-description-${pkg.id}`}>{t("description")}</Label>
          <Input
            id={`package-description-${pkg.id}`}
            name="description"
            defaultValue={pkg.description}
            maxLength={300}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`package-instructions-${pkg.id}`}>{t("instructions")}</Label>
        <textarea
          id={`package-instructions-${pkg.id}`}
          name="instructions"
          defaultValue={pkg.instructions}
          rows={10}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed"
        />
        <p className="text-xs text-muted-foreground">{t("instructionsHint")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          <Save aria-hidden />
          {t("save")}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export type TenantRolloutState = "none" | "current" | "outdated" | "adapted" | "archived";

const STATE_VARIANT: Record<TenantRolloutState, "secondary" | "success" | "warning" | "outline"> = {
  none: "outline",
  current: "success",
  outdated: "warning",
  adapted: "secondary",
  archived: "secondary",
};

const OUTCOMES = ["created", "updated", "current", "adapted", "archived", "unavailable"] as const;

/** Update first, then rolled out, then the rest – each alphabetically. */
const STATE_ORDER: Record<TenantRolloutState, number> = {
  outdated: 0,
  current: 1,
  adapted: 2,
  archived: 3,
  none: 4,
};

export function RolloutForm({
  packageId,
  tenants,
}: {
  packageId: string;
  tenants: { id: string; name: string; state: TenantRolloutState; version: number | null }[];
}) {
  const t = useTranslations("agentPackages");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState(
    async (
      previous: Awaited<ReturnType<typeof rolloutAgentPackageAction>> | null,
      form: FormData,
    ) => {
      const result = await rolloutAgentPackageAction(packageId, previous, form);
      // Done: start the next selection from scratch.
      if (result.ok) setSelected(new Set());
      return result;
    },
    null,
  );
  const sorted = useMemo(
    () =>
      [...tenants].sort(
        (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name, "de"),
      ),
    [tenants],
  );
  const needle = query.trim().toLowerCase();
  const visible = needle ? sorted.filter((x) => x.name.toLowerCase().includes(needle)) : sorted;
  const outdated = tenants.filter((x) => x.state === "outdated");
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const summary =
    state?.ok && state.data
      ? OUTCOMES.filter((key) => state.data?.[key])
          .map((key) => t(`outcomes.${key}`, { count: state.data![key]! }))
          .join(" · ")
      : null;
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t("rolloutTitle")}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchTenants")}
            aria-label={t("searchTenants")}
            className="h-8 min-w-0 flex-1"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={outdated.length === 0}
            onClick={() => setSelected(new Set(outdated.map((x) => x.id)))}
          >
            {t("selectOutdated", { count: outdated.length })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set(visible.map((x) => x.id)))}
          >
            {t("selectVisible")}
          </Button>
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
          {visible.map((tenant) => (
            <li key={tenant.id} data-testid="rollout-tenant">
              <label className="flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="tenantId"
                  value={tenant.id}
                  checked={selected.has(tenant.id)}
                  onChange={(event) => toggle(tenant.id, event.target.checked)}
                  className="accent-primary"
                  aria-label={tenant.name}
                />
                <span className="min-w-0 flex-1 truncate">{tenant.name}</span>
                <Badge variant={STATE_VARIANT[tenant.state]}>
                  {t(`states.${tenant.state}`, { version: tenant.version ?? 0 })}
                </Badge>
              </label>
            </li>
          ))}
          {visible.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t("noMatch")}</li>
          ) : null}
        </ul>
        {/* Selected companies outside the current search are still rolled out. */}
        {[...selected]
          .filter((id) => !visible.some((x) => x.id === id))
          .map((id) => (
            <input key={id} type="hidden" name="tenantId" value={id} />
          ))}
        <p className="text-xs text-muted-foreground">{t("rolloutHint")}</p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || selected.size === 0}>
          <Rocket aria-hidden />
          {t("rolloutCount", { count: selected.size })}
        </Button>
        {summary ? (
          <p role="status" className="text-sm text-success">
            {summary}
          </p>
        ) : null}
        {state && !state.ok ? <FieldError>{state.error}</FieldError> : null}
      </div>
    </form>
  );
}
