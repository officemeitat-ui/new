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
import { CloudDownload, Loader2, RefreshCw, Search, Unplug } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import {
  connectSharePointAction,
  disconnectSharePointAction,
  listSharePointLibrariesAction,
  searchSharePointSitesAction,
  syncSharePointAction,
} from "@/app/(app)/knowledge/actions";

type Source = {
  siteName: string;
  siteUrl: string | null;
  driveName: string;
  status: string;
  stale: boolean;
  lastSync: string | null;
  lastError: string | null;
  itemsSeen: number;
  itemsImported: number;
  itemsSkipped: number;
};

type Item = { id: string; name: string; webUrl: string };

export function SharePointSource({
  collectionId,
  source,
  microsoftConnected,
  canManage,
}: {
  collectionId: string;
  source: Source | null;
  microsoftConnected: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("sharepoint");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [wizard, setWizard] = useState(false);
  const [query, setQuery] = useState("");
  const [sites, setSites] = useState<Item[] | null>(null);
  const [site, setSite] = useState<Item | null>(null);
  const [libraries, setLibraries] = useState<Item[] | null>(null);
  const syncing = source?.status === "syncing" && !source.stale;

  // While the worker syncs, show its progress.
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [syncing, router]);

  const show = (result: { ok: boolean; message?: string; error?: string }) =>
    setMessage(
      result.ok
        ? { ok: true, text: result.message ?? "" }
        : { ok: false, text: result.error ?? "" },
    );

  function search(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await searchSharePointSitesAction(query);
      if (result.ok) {
        setSites(result.data ?? []);
        setSite(null);
        setLibraries(null);
        setMessage(null);
      } else show(result);
    });
  }

  function pickSite(chosen: Item) {
    setSite(chosen);
    start(async () => {
      const result = await listSharePointLibrariesAction(chosen.id);
      if (result.ok) setLibraries(result.data ?? []);
      else show(result);
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
      show(result);
      if (result.ok) setWizard(false);
    });
  }

  return (
    <Card data-testid="sharepoint">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t("title")}
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
                ? t("statusStale")
                : source.status === "error"
                  ? t("statusError")
                  : syncing
                    ? t("statusSyncing")
                    : t("statusIdle")}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {source ? (
          <>
            <p>
              <span className="font-medium">{source.driveName}</span>
              {" · "}
              {source.siteUrl ? (
                <a
                  href={source.siteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {source.siteName}
                </a>
              ) : (
                source.siteName
              )}
            </p>
            <p className="text-muted-foreground" aria-live="polite">
              {syncing
                ? t("progress", { seen: source.itemsSeen, imported: source.itemsImported })
                : source.lastSync
                  ? t("lastSync", {
                      when: source.lastSync,
                      imported: source.itemsImported,
                      skipped: source.itemsSkipped,
                    })
                  : t("neverSynced")}
            </p>
            {source.lastError ? <p className="text-danger">{source.lastError}</p> : null}
            <p className="text-xs text-muted-foreground">{t("hint")}</p>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || syncing}
                  onClick={() => start(async () => show(await syncSharePointAction(collectionId)))}
                >
                  <RefreshCw aria-hidden />
                  {t("syncNow")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(t("confirmDisconnect"))) return;
                    start(async () => show(await disconnectSharePointAction(collectionId)));
                  }}
                >
                  <Unplug aria-hidden />
                  {t("disconnect")}
                </Button>
              </div>
            ) : null}
          </>
        ) : !microsoftConnected ? (
          <p className="text-muted-foreground">
            {t("needsMicrosoft")}{" "}
            <Link href="/integrations" className="font-medium text-foreground underline">
              {t("toIntegrations")}
            </Link>
          </p>
        ) : !canManage ? (
          <p className="text-muted-foreground">{t("notConnected")}</p>
        ) : !wizard ? (
          <Button variant="outline" onClick={() => setWizard(true)}>
            <CloudDownload aria-hidden />
            {t("connect")}
          </Button>
        ) : (
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
          </div>
        )}
        {message ? (
          message.ok ? (
            <p role="status" className="text-success">
              {message.text}
            </p>
          ) : (
            <FieldError>{message.text}</FieldError>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
