"use client";

import {
  Badge,
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
import {
  BookOpen,
  CloudDownload,
  LifeBuoy,
  Loader2,
  RefreshCw,
  Search,
  Unplug,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState, useTransition, type FormEvent } from "react";
import {
  connectAteraAction,
  connectBookStackAction,
  connectSharePointAction,
  disconnectSharePointAction,
  listSharePointLibrariesAction,
  searchSharePointSitesAction,
  syncSharePointAction,
} from "@/app/(app)/knowledge/actions";

export type SourceView = {
  provider: "sharepoint" | "bookstack" | "atera";
  /** SharePoint library and site; BookStack host; Atera label. */
  name: string;
  detail: string | null;
  url: string | null;
  monthsBack: number | null;
  status: string;
  stale: boolean;
  lastSync: string | null;
  lastError: string | null;
  itemsSeen: number;
  itemsImported: number;
  itemsSkipped: number;
};

type Item = { id: string; name: string; webUrl: string };
type Provider = SourceView["provider"];

function Message({ value }: { value: { ok: boolean; text: string } | null }) {
  if (!value) return null;
  return value.ok ? (
    <p role="status" className="text-success">
      {value.text}
    </p>
  ) : (
    <FieldError>{value.text}</FieldError>
  );
}

function fromResult(result: { ok: boolean; message?: string; error?: string } | null) {
  if (!result) return null;
  return result.ok
    ? { ok: true, text: result.message ?? "" }
    : { ok: false, text: result.error ?? "" };
}

type Report = (message: { ok: boolean; text: string } | null) => void;

function SharePointWizard({ collectionId, report }: { collectionId: string; report: Report }) {
  const t = useTranslations("sharepoint");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [sites, setSites] = useState<Item[] | null>(null);
  const [site, setSite] = useState<Item | null>(null);
  const [libraries, setLibraries] = useState<Item[] | null>(null);

  function search(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await searchSharePointSitesAction(query);
      if (result.ok) {
        setSites(result.data ?? []);
        setSite(null);
        setLibraries(null);
        setMessage(null);
      } else setMessage(fromResult(result));
    });
  }

  function pickSite(chosen: Item) {
    setSite(chosen);
    start(async () => {
      const result = await listSharePointLibrariesAction(chosen.id);
      if (result.ok) setLibraries(result.data ?? []);
      else setMessage(fromResult(result));
    });
  }

  function connect(library: Item) {
    if (!site) return;
    start(async () => {
      const result = await connectSharePointAction({
        collectionId,
        siteId: site.id,
        siteName: site.name,
        siteUrl: site.webUrl,
        libraryId: library.id,
      });
      // Success replaces the wizard with the source, so the panel shows the message.
      if (result.ok) report(fromResult(result));
      else setMessage(fromResult(result));
    });
  }

  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="sharepoint-search">{t("siteSearch")}</Label>
          <Input
            id="sharepoint-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("siteSearchPlaceholder")}
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          <Search aria-hidden />
          {t("searchSites")}
        </Button>
      </form>
      {sites ? (
        sites.length === 0 ? (
          <p className="text-muted-foreground">{t("noSites")}</p>
        ) : (
          <ul className="divide-y rounded-md border" aria-label={t("sitesLabel")}>
            {sites.map((item) => (
              <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-xs text-muted-foreground"> {item.webUrl}</span>
                </span>
                <Button
                  size="sm"
                  variant={site?.id === item.id ? "default" : "outline"}
                  disabled={pending}
                  onClick={() => pickSite(item)}
                >
                  {t("chooseSite")}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {site && libraries ? (
        <ul className="divide-y rounded-md border" aria-label={t("librariesLabel")}>
          {libraries.map((library) => (
            <li key={library.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-medium">{library.name}</span>
              <Button size="sm" disabled={pending} onClick={() => connect(library)}>
                {t("connectLibrary")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Message value={message} />
    </div>
  );
}

function BookStackForm({ collectionId, report }: { collectionId: string; report: Report }) {
  const t = useTranslations("sources");
  // Controlled: React resets uncontrolled fields after a form action, also after an error.
  const [fields, setFields] = useState({ baseUrl: "", tokenId: "", tokenSecret: "" });
  const bind = (name: keyof typeof fields) => ({
    name,
    value: fields[name],
    onChange: (event: { target: { value: string } }) =>
      setFields((current) => ({ ...current, [name]: event.target.value })),
  });
  const [state, action, pending] = useActionState(
    async (previous: Awaited<ReturnType<typeof connectBookStackAction>> | null, form: FormData) => {
      const result = await connectBookStackAction(collectionId, previous, form);
      if (result.ok) report(fromResult(result));
      return result;
    },
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="bookstack-url">{t("bookstackUrl")}</Label>
        <Input
          id="bookstack-url"
          {...bind("baseUrl")}
          type="url"
          required
          placeholder="https://doku.firma.at"
          autoComplete="off"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bookstack-token-id">{t("bookstackTokenId")}</Label>
          <Input id="bookstack-token-id" {...bind("tokenId")} required autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bookstack-token-secret">{t("bookstackTokenSecret")}</Label>
          <Input
            id="bookstack-token-secret"
            {...bind("tokenSecret")}
            type="password"
            required
            autoComplete="off"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("bookstackHelp")}</p>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <BookOpen aria-hidden />}
        {t("connectTest")}
      </Button>
      {state && !state.ok ? <Message value={fromResult(state)} /> : null}
    </form>
  );
}

function AteraForm({ collectionId, report }: { collectionId: string; report: Report }) {
  const t = useTranslations("sources");
  // Controlled: React resets uncontrolled fields after a form action, also after an error.
  const [apiKey, setApiKey] = useState("");
  const [months, setMonths] = useState("12");
  const [state, action, pending] = useActionState(
    async (previous: Awaited<ReturnType<typeof connectAteraAction>> | null, form: FormData) => {
      const result = await connectAteraAction(collectionId, previous, form);
      if (result.ok) report(fromResult(result));
      return result;
    },
    null,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="space-y-1.5">
          <Label htmlFor="atera-key">{t("ateraKey")}</Label>
          <Input
            id="atera-key"
            name="apiKey"
            type="password"
            required
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="atera-months">{t("ateraPeriod")}</Label>
          <select
            id="atera-months"
            name="monthsBack"
            value={months}
            onChange={(event) => setMonths(event.target.value)}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            {[6, 12, 24, 36].map((months) => (
              <option key={months} value={months}>
                {t("months", { count: months })}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("ateraHelp")}</p>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LifeBuoy aria-hidden />}
        {t("connectTest")}
      </Button>
      {state && !state.ok ? <Message value={fromResult(state)} /> : null}
    </form>
  );
}

const TITLE: Record<Provider, string> = {
  sharepoint: "titleSharepoint",
  bookstack: "titleBookstack",
  atera: "titleAtera",
};

/**
 * Where a collection's documents come from: uploads plus at most one connected source
 * (SharePoint, BookStack or Atera), synchronised in the background.
 */
export function KnowledgeSource({
  collectionId,
  source,
  microsoftConnected,
  canManage,
}: {
  collectionId: string;
  source: SourceView | null;
  microsoftConnected: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("sources");
  const tSharePoint = useTranslations("sharepoint");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [choice, setChoice] = useState<Provider | null>(null);
  const syncing = source?.status === "syncing" && !source.stale;

  // While the worker syncs, show its progress.
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [syncing, router]);

  return (
    <Card data-testid="knowledge-source">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {source ? t(TITLE[source.provider]) : t("title")}
          {source ? (
            <Badge
              variant={
                source.status === "error" || source.stale
                  ? "danger"
                  : syncing
                    ? "warning"
                    : "success"
              }
            >
              {syncing ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              {source.stale
                ? tSharePoint("statusStale")
                : source.status === "error"
                  ? tSharePoint("statusError")
                  : syncing
                    ? tSharePoint("statusSyncing")
                    : tSharePoint("statusIdle")}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {source ? t(`description.${source.provider}`) : t("description.none")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {source ? (
          <>
            <p>
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                >
                  {source.name}
                </a>
              ) : (
                <span className="font-medium">{source.name}</span>
              )}
              {source.detail ? ` · ${source.detail}` : null}
              {source.monthsBack ? ` · ${t("ateraWindow", { count: source.monthsBack })}` : null}
            </p>
            <p className="text-muted-foreground" aria-live="polite">
              {syncing
                ? tSharePoint("progress", {
                    seen: source.itemsSeen,
                    imported: source.itemsImported,
                  })
                : source.lastSync
                  ? tSharePoint("lastSync", {
                      when: source.lastSync,
                      imported: source.itemsImported,
                      skipped: source.itemsSkipped,
                    })
                  : tSharePoint("neverSynced")}
            </p>
            {source.lastError ? <p className="text-danger">{source.lastError}</p> : null}
            <p className="text-xs text-muted-foreground">{t(`hint.${source.provider}`)}</p>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || syncing}
                  onClick={() =>
                    start(async () =>
                      setMessage(fromResult(await syncSharePointAction(collectionId))),
                    )
                  }
                >
                  <RefreshCw aria-hidden />
                  {tSharePoint("syncNow")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(t("confirmDisconnect"))) return;
                    start(async () =>
                      setMessage(fromResult(await disconnectSharePointAction(collectionId))),
                    );
                  }}
                >
                  <Unplug aria-hidden />
                  {tSharePoint("disconnect")}
                </Button>
              </div>
            ) : null}
          </>
        ) : !canManage ? (
          <p className="text-muted-foreground">{t("notConnected")}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("chooseLabel")}>
              <Button
                variant={choice === "sharepoint" ? "default" : "outline"}
                onClick={() => setChoice("sharepoint")}
              >
                <CloudDownload aria-hidden />
                {tSharePoint("connect")}
              </Button>
              <Button
                variant={choice === "bookstack" ? "default" : "outline"}
                onClick={() => setChoice("bookstack")}
              >
                <BookOpen aria-hidden />
                {t("connectBookstack")}
              </Button>
              <Button
                variant={choice === "atera" ? "default" : "outline"}
                onClick={() => setChoice("atera")}
              >
                <LifeBuoy aria-hidden />
                {t("connectAtera")}
              </Button>
            </div>
            {choice === "sharepoint" ? (
              microsoftConnected ? (
                <SharePointWizard collectionId={collectionId} report={setMessage} />
              ) : (
                <p className="text-muted-foreground">
                  {tSharePoint("needsMicrosoft")}{" "}
                  <Link href="/integrations" className="font-medium text-foreground underline">
                    {tSharePoint("toIntegrations")}
                  </Link>
                </p>
              )
            ) : null}
            {choice === "bookstack" ? (
              <BookStackForm collectionId={collectionId} report={setMessage} />
            ) : null}
            {choice === "atera" ? (
              <AteraForm collectionId={collectionId} report={setMessage} />
            ) : null}
          </>
        )}
        <Message value={message} />
      </CardContent>
    </Card>
  );
}
