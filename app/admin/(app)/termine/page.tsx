import Link from "next/link";
import { business, getService } from "@/config/business";
import { bookManually, cancelAppointmentAction, retryCalendarSync } from "@/app/admin/assistant-actions";
import { CalendarTestButton } from "@/components/CalendarPanels";
import { busyBetween, listAppointments, type Appointment } from "@/lib/appointments";
import { requireOwner } from "@/lib/auth";
import { addDays, localDate, localTime, slotsForDay, zonedToUtc, type Busy } from "@/lib/calendar";
import { calendarProvider, CalendarSyncError } from "@/lib/calendar-sync";

const DAYS_SHOWN = 14;
const sourceLabel = { telefon: "Telefon-Assistent", whatsapp: "WhatsApp-Assistent", email: "E-Mail", manuell: "Manuell" };

function dayHeading(date: string) {
  return new Intl.DateTimeFormat("de-AT", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

const channelLabel = (channel: string | null) => (channel === "sms" ? "SMS" : "E-Mail");

/** Zeigt, ob der Kunde Bestätigung und Erinnerung erhalten hat. */
function NotificationStatus({ appointment }: { appointment: Appointment }) {
  const items: { ok: boolean; text: string }[] = [];
  if (appointment.confirmationSentAt) {
    items.push(
      appointment.confirmationChannel
        ? { ok: true, text: `bestätigt per ${channelLabel(appointment.confirmationChannel)}` }
        : { ok: false, text: "Bestätigung nicht zustellbar" },
    );
  }
  if (appointment.reminderSentAt) {
    items.push(
      appointment.reminderChannel
        ? { ok: true, text: `erinnert per ${channelLabel(appointment.reminderChannel)}` }
        : { ok: false, text: "Erinnerung nicht zustellbar" },
    );
  }
  if (items.length === 0) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-2 text-xs" title={appointment.notifyError ?? undefined}>
      {items.map((item) => (
        <span key={item.text} className={item.ok ? "text-emerald-700" : "text-amber-700"}>
          {item.ok ? "✓" : "⚠"} {item.text}
        </span>
      ))}
    </span>
  );
}

function AppointmentRow({ appointment, synced }: { appointment: Appointment; synced: boolean }) {
  const service = getService(appointment.serviceId);
  const cancelled = appointment.status === "storniert";
  // Mit externem Kalender: gebuchte Termine müssen dort stehen, stornierte dort gelöscht sein.
  const outOfSync = synced && (cancelled ? Boolean(appointment.externalId) : !appointment.externalId);
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm ${cancelled ? "text-slate-400 line-through" : ""}`}>
      <span className="w-24 font-semibold tabular-nums">
        {localTime(appointment.start, business.timeZone)}–{localTime(appointment.end, business.timeZone)}
      </span>
      <span className="min-w-40 flex-1">
        {appointment.leadId ? (
          <Link href={`/admin/leads/${appointment.leadId}`} className="font-medium hover:text-brand">
            {appointment.name}
          </Link>
        ) : (
          <span className="font-medium">{appointment.name}</span>
        )}
        {appointment.phone && <span className="text-slate-500"> · {appointment.phone}</span>}
        {appointment.notes && <span className="block text-slate-500">{appointment.notes}</span>}
        {!cancelled && <NotificationStatus appointment={appointment} />}
      </span>
      <span>{service?.name ?? appointment.serviceId}</span>
      <span className="text-xs text-slate-500">{sourceLabel[appointment.source]}</span>
      {!cancelled && (
        <form action={cancelAppointmentAction}>
          <input type="hidden" name="appointmentId" value={appointment.id} />
          <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
            Stornieren
          </button>
        </form>
      )}
      {outOfSync && (
        <form action={retryCalendarSync} className="flex w-full items-center gap-3 no-underline">
          <input type="hidden" name="appointmentId" value={appointment.id} />
          <span className="flex-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800" title={appointment.syncError ?? undefined}>
            ⚠ {cancelled ? "Im externen Kalender noch nicht gelöscht" : "Nicht im externen Kalender"}
            {appointment.syncError && `: ${appointment.syncError.slice(0, 120)}`}
          </span>
          <button type="submit" className="text-xs font-medium text-brand hover:underline">
            Erneut übertragen
          </button>
        </form>
      )}
    </li>
  );
}

export default async function AppointmentsPage({ searchParams }: PageProps<"/admin/termine">) {
  await requireOwner();
  const params = await searchParams;
  const now = new Date();
  const today = localDate(now, business.timeZone);
  const from = zonedToUtc(today, "00:00", business.timeZone);
  const appointments = await listAppointments(from, zonedToUtc(addDays(today, DAYS_SHOWN), "00:00", business.timeZone));

  const days = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const day = localDate(a.start, business.timeZone);
    days.set(day, [...(days.get(day) ?? []), a]);
  }

  // Manuelle Buchung: freie Zeiten für gewählte Leistung und gewähltes Datum
  const service = getService(String(params.leistung ?? "")) ?? business.services[0];
  const requested = /^\d{4}-\d{2}-\d{2}$/.test(String(params.datum ?? "")) ? String(params.datum) : null;
  // Ohne gewähltes Datum den nächsten Tag mit freien Zeiten vorschlagen (z. B. nicht den geschlossenen Sonntag).
  const searchFrom = requested ?? today;
  const searchTo = requested ? addDays(requested, 1) : addDays(today, DAYS_SHOWN);
  let calendarError: string | null = null;
  let calendarLabel: string | null = null;
  try {
    calendarLabel = calendarProvider()?.label ?? null;
  } catch (error) {
    if (!(error instanceof CalendarSyncError)) throw error;
    calendarError = error.message;
  }
  let busy: Busy[] = [];
  try {
    busy = await busyBetween(zonedToUtc(searchFrom, "00:00", business.timeZone), zonedToUtc(searchTo, "00:00", business.timeZone));
  } catch (error) {
    if (!(error instanceof CalendarSyncError)) throw error;
    calendarError = error.message;
  }
  const synced = calendarLabel !== null;
  let date = searchFrom;
  // Ist der externe Kalender nicht erreichbar, keine Zeiten anbieten (sonst drohen Doppelbuchungen).
  const slotsFor = (day: string) => (calendarError ? [] : slotsForDay(business, service.durationMinutes, day, busy, now));
  let freeSlots = slotsFor(date);
  for (let i = 1; !requested && !calendarError && freeSlots.length === 0 && i < DAYS_SHOWN; i++) {
    date = addDays(today, i);
    freeSlots = slotsFor(date);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <h1 className="text-2xl font-bold">Termine</h1>
          <p className="text-sm text-slate-500">
            Die nächsten {DAYS_SHOWN} Tage – gebucht vom Telefon-Assistenten, per E-Mail oder manuell.
          </p>
        </div>
        {days.size === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            Keine Termine in diesem Zeitraum.
          </p>
        ) : (
          [...days.entries()].map(([day, list]) => (
            <section key={day} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold">{dayHeading(day)}</h2>
              <ul className="divide-y divide-slate-100">
                {list.map((a) => (
                  <AppointmentRow key={a.id} appointment={a} synced={synced} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <aside className="h-fit space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Kalender</h2>
          <p className="mt-1 text-sm text-slate-600">
            {synced
              ? `Verbunden mit ${calendarLabel}: Termine dort zählen als belegt, neue Buchungen werden eingetragen.`
              : calendarError
                ? "Externer Kalender gewählt, aber nicht nutzbar."
                : "Nur interner Kalender. Google oder Microsoft 365 lassen sich über CALENDAR_PROVIDER anbinden."}
          </p>
          {calendarError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{calendarError}</p>}
          {(synced || calendarError) && (
            <div className="mt-3">
              <CalendarTestButton />
            </div>
          )}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Termin eintragen</h2>
          {params.gebucht && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Termin eingetragen.</p>}
          {params.fehler && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {
                {
                  belegt: "Dieser Termin ist inzwischen belegt.",
                  kalender: "Der externe Kalender ist nicht erreichbar – nichts gebucht.",
                  angaben: "Bitte Zeit und Name angeben.",
                }[String(params.fehler)]
              }
            </p>
          )}
          <form className="mt-4 space-y-3 text-sm">
            <select name="leistung" defaultValue={service.id} className="w-full rounded-lg border border-slate-300 px-3 py-2">
              {business.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes} Min.)
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="date"
                name="datum"
                defaultValue={date}
                min={today}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
              />
              <button type="submit" className="rounded-lg border border-slate-300 px-3 py-2 font-medium hover:bg-slate-50">
                Zeiten zeigen
              </button>
            </div>
          </form>
          <form action={bookManually} className="mt-4 space-y-3 text-sm">
            <input type="hidden" name="serviceId" value={service.id} />
            {freeSlots.length === 0 ? (
              <p className="text-slate-500">
                {calendarError ? "Ohne erreichbaren Kalender keine Buchung möglich." : "An diesem Tag ist nichts frei."}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {freeSlots.map((slot, i) => (
                  <label key={slot.toISOString()} className="cursor-pointer">
                    <input type="radio" name="start" value={slot.toISOString()} defaultChecked={i === 0} className="peer sr-only" />
                    <span className="block rounded-lg border border-slate-300 py-1.5 text-center tabular-nums peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:font-semibold">
                      {localTime(slot, business.timeZone)}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <input name="name" required placeholder="Name" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            <input name="phone" placeholder="Telefon (optional)" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            <input
              name="email"
              type="email"
              placeholder="E-Mail (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <button
              type="submit"
              disabled={freeSlots.length === 0}
              className="w-full rounded-lg bg-brand py-2 font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              Eintragen
            </button>
          </form>
        </section>
      </aside>
    </div>
  );
}
