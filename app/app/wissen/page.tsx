import { AskKnowledge, FileList } from "@/components/workspace/FilesUI";
import { workspace } from "@/config/workspace";
import { requireAdmin } from "@/lib/auth";
import { microsoftLoginConfigured } from "@/lib/entra";
import { M365Error, searchFiles, type DriveFile } from "@/lib/m365";
import { microsoftRefreshToken } from "@/lib/users";

/** Wissen & Dateien: Suche über OneDrive und SharePoint, Wissensdatenbank mit KI-Antwort. */
export default async function WissenPage({ searchParams }: PageProps<"/app/wissen">) {
  const user = await requireAdmin();
  const { q, bereich } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const site = workspace.knowledge.sharePointSiteUrl.trim();
  const onlyKnowledge = bereich === "wissen" && Boolean(site);
  const connected = Boolean(await microsoftRefreshToken(user.id));

  let hits: DriveFile[] = [];
  let error: string | null = null;
  if (query && connected) {
    try {
      hits = await searchFiles(user.id, query, { sitePath: onlyKnowledge ? site : undefined, size: 25 });
    } catch (e) {
      if (!(e instanceof M365Error)) throw e;
      error = e.message;
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Wissen & Dateien</h1>
        <p className="text-sm text-slate-500">OneDrive und SharePoint durchsuchen – mit deinen eigenen Microsoft-Rechten.</p>
      </div>

      {!connected ? (
        <section className="space-y-2 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="text-sm text-amber-900">
            {microsoftLoginConfigured()
              ? "Melde dich einmal mit Microsoft an, dann siehst du hier deine Dateien aus OneDrive und SharePoint."
              : "Für OneDrive und SharePoint muss die Microsoft-Anmeldung eingerichtet sein (siehe README → Microsoft-Anmeldung)."}
          </p>
          {microsoftLoginConfigured() && (
            <a
              href="/api/auth/microsoft?weiter=/app/wissen"
              className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
            >
              Mit Microsoft anmelden
            </a>
          )}
        </section>
      ) : (
        <>
          <form className="flex flex-wrap gap-2">
            <input
              name="q"
              defaultValue={query}
              autoFocus
              placeholder="z. B. „Angebot Firewall Huber“, „Onboarding Checkliste“, „Wartungsvertrag“"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand focus:outline-none md:text-sm"
            />
            {site && (
              <select
                name="bereich"
                defaultValue={onlyKnowledge ? "wissen" : "alle"}
                className="rounded-xl border border-slate-300 bg-white px-2 text-sm"
                aria-label="Bereich"
              >
                <option value="alle">Überall</option>
                <option value="wissen">Nur Wissensdatenbank</option>
              </select>
            )}
            <button type="submit" className="rounded-xl bg-brand px-4 text-sm font-semibold text-white">
              Suchen
            </button>
          </form>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {query &&
            !error &&
            (hits.length ? (
              <FileList files={hits} timeZone={workspace.timeZone} />
            ) : (
              <p className="text-sm text-slate-500">Nichts gefunden.</p>
            ))}
          <AskKnowledge timeZone={workspace.timeZone} />
        </>
      )}

      {!site && (
        <p className="text-sm text-slate-500">
          Tipp: Mit einer SharePoint-Website als Wissensdatenbank (Adresse in <code>config/workspace.ts</code> → <code>knowledge</code>)
          sucht und antwortet der Arbeitsplatz gezielt dort. Aufbau-Vorschlag: <code>docs/sharepoint-wissensdatenbank.md</code>.
        </p>
      )}
    </div>
  );
}
