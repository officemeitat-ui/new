import Link from "next/link";
import { notFound } from "next/navigation";
import { workspace } from "@/config/workspace";
import { unlinkCustomerFolder } from "@/app/app/m365-actions";
import { FileList, LinkFolderForm } from "@/components/workspace/FilesUI";
import { BookServiceForm, ProfileForm, RemoveService } from "@/components/workspace/ContractUI";
import { CustomerForm, QuickAddTask, TaskCheck } from "@/components/workspace/Forms";
import { INDUSTRIES, PACKAGES } from "@/config/services";
import { eolStatus } from "@/lib/lifecycle";
import { bookedServices, contractProfile, eur, listServices } from "@/lib/workspace/catalog";
import { requireAdmin } from "@/lib/auth";
import { localDate } from "@/lib/calendar";
import { listFolder, M365Error, type DriveFile } from "@/lib/m365";
import { microsoftRefreshToken } from "@/lib/users";
import { listChecklists } from "@/lib/workspace/checklists";
import { HEALTH_STYLE, healthFor } from "@/lib/workspace/health";
import { getCustomer, listAlerts, listCustomers, listDevices, listTickets, TICKET_STATUS_LABELS } from "@/lib/workspace/customers";
import { ago, BALANCE_STYLE, dueLabel, formatHours, PRIORITY_DOT, SEVERITY_STYLE } from "@/lib/workspace/format";
import { getAccount } from "@/lib/workspace/hours";
import { listTasks } from "@/lib/workspace/tasks";

export default async function KundePage({ params }: PageProps<"/app/kunden/[id]">) {
  const user = await requireAdmin();
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const today = localDate(new Date(), workspace.timeZone);
  const [tickets, alerts, devices, tasks, customers, account] = await Promise.all([
    listTickets({ customerId: id }),
    listAlerts(id),
    listDevices(id),
    listTasks("alle", today, { customerId: id }),
    listCustomers(),
    getAccount(id, today.slice(0, 7)),
  ]);
  const offline = devices.filter((d) => d.online === false).length;
  const [health, checklists, profile, booked, catalog] = await Promise.all([
    healthFor(id),
    listChecklists({ customerId: id, open: true }),
    contractProfile(id),
    bookedServices(id),
    listServices(),
  ]);
  const mrr = booked.reduce((sum, b) => sum + b.monthly, 0);
  // Kundenordner in OneDrive/SharePoint – mit den Rechten der angemeldeten Person
  const microsoft = Boolean(await microsoftRefreshToken(user.id));
  let files: DriveFile[] = [];
  let filesError: string | null = null;
  if (customer.files && microsoft) {
    try {
      files = await listFolder(user.id, customer.files.driveId, customer.files.itemId);
    } catch (error) {
      if (!(error instanceof M365Error)) throw error;
      filesError = error.message;
    }
  }

  return (
    <div className="space-y-4">
      <Link href="/app/kunden" className="text-sm text-slate-500 hover:text-slate-900">
        ← Kunden
      </Link>
      <header className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold">{customer.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {[customer.address, customer.ateraId ? `Atera #${customer.ateraId}` : null].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {customer.phone && (
            <a href={`tel:${customer.phone}`} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
              Anrufen
            </a>
          )}
          {customer.email && (
            <a href={`mailto:${customer.email}`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium">
              E-Mail
            </a>
          )}
          <a
            href={customer.keeperUrl ?? workspace.keeper.vaultUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"
          >
            {customer.keeperUrl ? "Zugänge in Keeper" : "Keeper öffnen"}
          </a>
          <Link
            href={`/app/kunden/${customer.id}/doku`}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Dokumentation
          </Link>
          <Link
            href={`/app/assistent?frage=${encodeURIComponent(`Wie ist der Stand bei ${customer.name}?`)}`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium"
          >
            Assistent fragen
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            [tickets.length, "Tickets"],
            [alerts.length, "Warnungen"],
            [`${devices.length - offline}/${devices.length}`, "online"],
            [tasks.length, "Aufgaben"],
          ].map(([value, label]) => (
            <div key={String(label)} className="rounded-xl bg-slate-50 py-2">
              <p className="text-lg font-bold">{value}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          ))}
        </div>
        <Link
          href={`/app/stunden/${customer.id}`}
          className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm hover:bg-slate-100"
        >
          <span className="font-medium">Stundenkonto</span>
          <span className={`font-semibold tabular-nums ${BALANCE_STYLE[account?.status ?? "kein_paket"].className}`}>
            {account && account.purchased > 0
              ? `${formatHours(account.balance)} übrig${BALANCE_STYLE[account.status].label ? ` · ${BALANCE_STYLE[account.status].label}` : ""}`
              : "kein Paket – Zeit buchen →"}
          </span>
        </Link>
      </header>

      <section className="grid gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-3 md:flex-col md:justify-center md:px-4">
          <span className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl font-black ${HEALTH_STYLE[health.grade]}`}>
            {health.score}
          </span>
          <span className="text-sm font-semibold">Gesundheit: {health.grade}</span>
        </div>
        <ul className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {health.factors.map((f) => (
            <li key={f.label}>
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700">{f.label}</span>
                <span className="text-slate-500">
                  {f.points}/{f.max}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${f.points / f.max >= 0.8 ? "bg-emerald-500" : f.points / f.max >= 0.5 ? "bg-amber-400" : "bg-red-500"}`}
                  style={{ width: `${Math.round((f.points / f.max) * 100)}%` }}
                />
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{f.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Vertrag & Leistungen</h2>
          <span className="text-sm">
            Paket <strong>{PACKAGES[profile.package]}</strong> · MRR <strong>{eur(mrr)}</strong>
            {profile.contractEnd
              ? ` · bis ${new Intl.DateTimeFormat("de-AT", { dateStyle: "medium" }).format(new Date(profile.contractEnd))}`
              : ""}
          </span>
        </div>
        <ProfileForm customerId={customer.id} profile={profile} packages={PACKAGES} industries={INDUSTRIES} />
        {booked.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {booked.map((b) => (
              <li key={b.code} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{b.name}</span>{" "}
                  <span className="text-xs text-slate-500">
                    {b.quantity.toLocaleString("de-AT")} × {eur(b.price)} / {b.unit}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{b.recurring ? `${eur(b.monthly)} / Monat` : "einmalig"}</span>
                <RemoveService customerId={customer.id} code={b.code} />
              </li>
            ))}
          </ul>
        )}
        <BookServiceForm
          customerId={customer.id}
          services={catalog.map((s) => ({ code: s.code, name: s.name, unit: s.unit, price: s.price }))}
        />
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/app/radar?kunde=${customer.id}`}
            className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50"
          >
            Chancen (Umsatz-Radar)
          </Link>
          <Link href={`/app/angebote/neu?kunde=${customer.id}`} className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">
            Angebot erstellen
          </Link>
        </div>
      </section>

      {checklists.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Offene Checklisten</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {checklists.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/checklisten/${c.id}`}
                  className="block rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200 hover:ring-brand"
                >
                  <span className="block font-medium">{c.title}</span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className="block h-full rounded-full bg-brand"
                      style={{ width: `${c.total ? Math.round((c.done / c.total) * 100) : 0}%` }}
                    />
                  </span>
                  <span className="text-xs text-slate-500">
                    {c.done}/{c.total} erledigt
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 font-semibold">Offene Tickets</h2>
          {tickets.length === 0 ? (
            <p className="text-sm text-slate-500">Keine.</p>
          ) : (
            <ul className="space-y-2">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link href={`/app/tickets/${t.id}`} className="flex items-start gap-2 text-sm">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[t.priority ?? "Low"] ?? "bg-slate-300"}`} />
                    <span>
                      <span className="font-medium">{t.title}</span>
                      <span className="block text-xs text-slate-500">
                        {TICKET_STATUS_LABELS[t.status] ?? t.status}
                        {t.waitingForUs && " · wartet auf dich"} · {ago(t.lastCustomerCommentAt ?? t.createdAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 font-semibold">Warnungen</h2>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-500">Keine aktiven Warnungen.</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-sm">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${SEVERITY_STYLE[a.severity ?? ""] ?? "bg-slate-100"}`}>
                    {a.severity ?? "Info"}
                  </span>
                  <span>
                    <span className="font-medium">{a.title}</span>
                    <span className="block text-xs text-slate-500">{[a.deviceName, ago(a.createdAt)].filter(Boolean).join(" · ")}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Geräte</h2>
          {devices.length === 0 ? (
            <p className="text-sm text-slate-500">Keine Geräte aus Atera.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.online ? "bg-emerald-500" : d.online === false ? "bg-red-500" : "bg-slate-300"}`}
                  />
                  <span className="min-w-0 flex-1">
                    {d.appUrl ? (
                      <a href={d.appUrl} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                        {d.name}
                      </a>
                    ) : (
                      <span className="font-medium">{d.name}</span>
                    )}
                    <span className="block truncate text-xs text-slate-500">
                      {[d.os, d.loggedUser, d.online === false && d.lastSeen ? `zuletzt ${ago(d.lastSeen)}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {(() => {
                      const eol = eolStatus(d.os, today);
                      return eol && eol.state !== "ok" ? (
                        <span
                          className={`mt-0.5 inline-block rounded px-1.5 text-[11px] font-medium ${eol.state === "abgelaufen" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}
                        >
                          {eol.state === "abgelaufen" ? "kein Support mehr" : "Support endet"} ({eol.label}, {eol.end.slice(0, 7)})
                        </span>
                      ) : null;
                    })()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">Aufgaben</h2>
        <QuickAddTask lists={workspace.lists} customers={customers.map((c) => ({ id: c.id, name: c.name }))} customerId={customer.id} />
        {tasks.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {tasks.map((task) => {
              const due = task.dueDate ? dueLabel(task.dueDate, today) : null;
              return (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                  <TaskCheck id={task.id} done={false} label={task.title} />
                  <Link href={`/app/aufgaben/${task.id}`} className="min-w-0 flex-1">
                    <span className="block font-medium">{task.title}</span>
                    {due && <span className={`text-xs ${due.tone === "overdue" ? "text-red-600" : "text-slate-500"}`}>{due.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Dateien</h2>
          {customer.files && (
            <span className="flex gap-3 text-sm">
              <a href={customer.files.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                In OneDrive/SharePoint öffnen
              </a>
              <form action={unlinkCustomerFolder}>
                <input type="hidden" name="customerId" value={customer.id} />
                <button type="submit" className="text-slate-400 hover:text-red-700">
                  Trennen
                </button>
              </form>
            </span>
          )}
        </div>
        {!microsoft ? (
          <p className="rounded-xl bg-white px-4 py-3 text-sm text-slate-500 ring-1 ring-slate-200">
            Für den Kundenordner einmal{" "}
            <a href={`/api/auth/microsoft?weiter=/app/kunden/${customer.id}`} className="text-brand underline">
              mit Microsoft anmelden
            </a>
            .
          </p>
        ) : !customer.files ? (
          <LinkFolderForm customerId={customer.id} />
        ) : filesError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{filesError}</p>
        ) : files.length ? (
          <FileList files={files.slice(0, 15)} timeZone={workspace.timeZone} />
        ) : (
          <p className="text-sm text-slate-500">Der Ordner ist leer.</p>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 font-semibold">Stammdaten & Notizen</h2>
        <CustomerForm customer={customer} />
      </section>
    </div>
  );
}
