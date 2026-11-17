import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { claudeClient, fallbackOptions } from "@/lib/ai-client";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { workspace } from "@/config/workspace";
import { addDays, localDate, localTime, zonedToUtc } from "@/lib/calendar";
import { ateraConfigured, ateraTicketComments } from "@/lib/atera";
import {
  findCustomer,
  getTicket,
  listAlerts,
  listCustomers,
  listDevices,
  listTickets,
  TICKET_STATUS_LABELS,
} from "@/lib/workspace/customers";
import { createEvent, createMailDraft, listEvents, outlookConfigured } from "@/lib/workspace/outlook";
import { completeTask, createTask, findOpenTasks, getTask, listTasks, type Task } from "@/lib/workspace/tasks";
import { formatHours } from "@/lib/workspace/format";
import { addPackage, addTimeEntry, getAccount, listEntries, TIME_MODE_LABELS } from "@/lib/workspace/hours";
import { bookstackConfigured, searchBookStack } from "@/lib/bookstack";
import { searchDocs } from "@/lib/workspace/docs";
import { loadNetwork } from "@/lib/workspace/network";
import { checkNetwork } from "@/lib/network/check";
import { M365Error, searchFiles } from "@/lib/m365";
import { allDeadlines } from "@/lib/workspace/deadlines";

// Persönlicher KI-Assistent im Arbeitsplatz: „Setz mir morgen um 9 einen Termin bei Huber“, „Schreib Maria, dass …“.
// Führt sichere Aktionen direkt aus (Aufgabe, eigener Kalendereintrag, E-Mail-Entwurf) – gesendet wird nie etwas.

const MODEL = process.env.ASSISTANT_MODEL || "claude-opus-5-5";
const MAX_HISTORY = 20;

export type AssistantAction = {
  kind: "aufgabe" | "erledigt" | "termin" | "entwurf" | "zeit" | "stunden" | "link";
  title: string;
  detail?: string;
  href?: string;
};
export type AssistantTurn = { role: "user" | "assistant"; text: string };
/** Wer gerade fragt. Outlook (Kalender, Entwürfe) ist das Postfach der Inhaberin bzw. des Inhabers – nur dafür freigegeben. */
export type AssistantUser = { id: string; name: string; role: "inhaber" | "technik" };
export type AssistantReply = { text: string; actions: AssistantAction[] };

const client = claudeClient;

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
const germanDate = (date: string) => `${weekday(date)}, ${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

function describeTask(task: Task): string {
  const due = task.dueDate ? ` · fällig ${germanDate(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ""}` : "";
  return `[${task.id}] ${task.title}${task.customerName ? ` (${task.customerName})` : ""}${due}${task.priority === "hoch" ? " · dringend" : ""}`;
}

async function systemPrompt(now: Date, user: AssistantUser | null, outlook: boolean): Promise<string> {
  const today = localDate(now, workspace.timeZone);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((d) => `${weekday(d)} = ${d}`);
  const customers = (await listCustomers()).slice(0, 200).map((c) => c.name);
  return [
    `Du bist der persönliche Assistent von ${user?.name.split(" ")[0] ?? workspace.ownerName} (${workspace.company}, IT-Dienstleister). Du nimmst Arbeit ab: Aufgaben, Termine, E-Mail-Entwürfe, Überblick über Kunden und Tickets.`,
    "",
    "## Regeln",
    "- Antworte kurz auf Deutsch, per Du, ohne Überschriften. Bestätige, was du erledigt hast, in einem Satz.",
    "- Wenn der Auftrag klar ist, führe ihn direkt mit den Werkzeugen aus, ohne nachzufragen. Fehlt etwas Wesentliches (z. B. Uhrzeit eines Termins, Empfänger einer E-Mail), frag kurz nach.",
    "- Datumsangaben wie „morgen“, „Donnerstag“ oder „nächste Woche“ rechnest du mit der Tabelle unten um. Ohne Uhrzeit ist eine Aufgabe ganztägig.",
    "- E-Mails legst du nur als Entwurf an. Schreib sie fertig formuliert, freundlich und knapp, per Sie, mit Grußformel und dem Namen " +
      `${user?.name ?? workspace.ownerName}. Du sendest nie selbst.`,
    "- Termine trägst du nur in den eigenen Kalender ein, ohne Teilnehmer. Soll der Kunde Bescheid bekommen, biete einen E-Mail-Entwurf an.",
    "- Passwörter und Zugangsdaten verwaltest du nie und fragst nie danach – die liegen in Keeper. Verweise auf den Keeper-Link beim Kunden.",
    "- Erfinde keine Tickets, Kunden, Geräte oder Termine. Nutze die Werkzeuge, um nachzusehen.",
    "- Die Nachrichten können diktiert sein (Spracheingabe) – deute offensichtliche Hörfehler sinnvoll.",
    "- Fragen zu Verkabelung, Dosen, Switchports, Patchschrank, VLANs, Netzwerkgeräten oder zur Kunden-Doku beantwortest du mit doku_suchen – nur mit dem, was dort steht.",
    "- Fragen wie „Was läuft demnächst ab?“ oder „Welche Verträge muss ich kündigen?“ beantwortest du mit fristen_anzeigen.",
    "- „Passt das Netz bei …?“ oder Fragen nach Fehlern in der Netzwerkkonfiguration beantwortest du mit netzwerk_pruefen.",
    "- Dateien, Angebote, Verträge, Anleitungen oder Vorlagen suchst du mit dateien_suchen (OneDrive/SharePoint, mit den Rechten der Person). Nenne die Fundstellen mit Link.",
    "- Zeiten buchst du standardmäßig vom vorab bezahlten Stundenpaket des Kunden ab, außer es heißt „extra verrechnen“ oder „intern“. Nenne danach den Reststand.",
    "",
    "## Zeit",
    `Jetzt: ${germanDate(today)}, ${localTime(now, workspace.timeZone)} Uhr (${workspace.timeZone}).`,
    `Kalender der nächsten zwei Wochen: ${days.join(", ")}.`,
    "",
    "## Arbeitsplatz",
    `Aufgabenlisten: ${workspace.lists.join(", ")}.`,
    `Kunden: ${customers.length ? customers.join(", ") : "noch keine angelegt"}.`,
    `Outlook: ${outlook ? "verbunden (Kalender und Entwürfe)" : "nicht verbunden – Termine werden als Aufgabe mit Uhrzeit angelegt, E-Mails als Text geliefert"}.`,
    `Atera: ${ateraConfigured() ? "verbunden" : "nicht verbunden"}.`,
  ].join("\n");
}

function toMessages(history: AssistantTurn[]): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = history
    .slice(-MAX_HISTORY)
    .filter((t) => t.text.trim())
    .map((t) => ({ role: t.role, content: t.text }));
  while (messages.length > 0 && messages[0].role !== "user") messages.shift();
  return messages;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/** Werkzeuge des Assistenten; Aktionen werden gesammelt, damit die App sie als Karten anzeigen kann. */
function buildTools(now: Date, actions: AssistantAction[], user: AssistantUser | null, outlook: boolean) {
  const today = localDate(now, workspace.timeZone);
  const customerId = async (name?: string) => (name ? ((await findCustomer(name))?.id ?? null) : null);
  const safe = async (task: () => Promise<string>) => {
    try {
      return await task();
    } catch (error) {
      console.error("Assistent-Werkzeug fehlgeschlagen:", error);
      return `Fehler: ${error instanceof Error ? error.message : String(error)}. Sag das dem Nutzer ehrlich.`;
    }
  };

  return [
    betaZodTool({
      name: "aufgabe_anlegen",
      description: "Legt eine Aufgabe (To-do) an, optional mit Fälligkeit, Uhrzeit, Kunde, Liste und Wiederholung.",
      inputSchema: z.object({
        titel: z.string().describe("Kurz und konkret, z. B. „Backup-Prüfung Huber“"),
        faellig_am: z.string().optional().describe("JJJJ-MM-TT"),
        uhrzeit: z.string().optional().describe("HH:MM, nur wenn genannt"),
        prioritaet: z.enum(["hoch", "normal", "niedrig"]).optional(),
        liste: z
          .string()
          .optional()
          .describe(`Eine von: ${workspace.lists.join(", ")}`),
        kunde: z.string().optional().describe("Kundenname, falls die Aufgabe einen Kunden betrifft"),
        notiz: z.string().optional(),
        wiederholung: z.enum(["taeglich", "woechentlich", "monatlich"]).optional(),
      }),
      run: (args) =>
        safe(async () => {
          if (args.faellig_am && !DATE.test(args.faellig_am)) return "Fehler: faellig_am muss JJJJ-MM-TT sein.";
          const listName = workspace.lists.find((l) => l.toLowerCase() === args.liste?.toLowerCase()) ?? workspace.lists[0];
          const task = await createTask(
            {
              title: args.titel,
              notes: args.notiz,
              listName,
              dueDate: args.faellig_am || null,
              dueTime: args.uhrzeit && /^\d{2}:\d{2}$/.test(args.uhrzeit) ? args.uhrzeit : null,
              priority: args.prioritaet ?? "normal",
              recurrence: args.wiederholung ?? null,
              customerId: await customerId(args.kunde),
              source: "assistent",
            },
            now,
          );
          const detail = [
            task.customerName,
            task.dueDate ? `fällig ${germanDate(task.dueDate)}${task.dueTime ? `, ${task.dueTime}` : ""}` : null,
            task.recurrence ? "wiederkehrend" : null,
            task.priority === "hoch" ? "dringend" : null,
          ]
            .filter(Boolean)
            .join(" · ");
          actions.push({ kind: "aufgabe", title: task.title, detail: detail || undefined, href: "/app/aufgaben" });
          return `Angelegt: ${describeTask(task)}`;
        }),
    }),
    betaZodTool({
      name: "aufgaben_anzeigen",
      description: "Listet offene Aufgaben: heute (inkl. überfällig), demnächst (14 Tage) oder alle; optional nur für einen Kunden.",
      inputSchema: z.object({ ansicht: z.enum(["heute", "demnaechst", "alle"]), kunde: z.string().optional() }),
      run: (args) =>
        safe(async () => {
          const id = await customerId(args.kunde);
          if (args.kunde && !id) return `Keinen Kunden „${args.kunde}“ gefunden.`;
          const tasks = await listTasks(args.ansicht, today, id ? { customerId: id } : {});
          return tasks.length ? tasks.slice(0, 40).map(describeTask).join("\n") : "Keine offenen Aufgaben in dieser Ansicht.";
        }),
    }),
    betaZodTool({
      name: "aufgabe_erledigen",
      description: "Hakt eine Aufgabe ab – per ID aus einer Liste oder per Suchbegriff. Bei mehreren Treffern nachfragen.",
      inputSchema: z.object({ aufgabe_id: z.string().optional(), suchbegriff: z.string().optional() }),
      run: (args) =>
        safe(async () => {
          let task = args.aufgabe_id ? await getTask(args.aufgabe_id) : null;
          if (!task && args.suchbegriff) {
            const found = await findOpenTasks(args.suchbegriff);
            if (found.length > 1) return `Mehrere Treffer – welche?\n${found.map(describeTask).join("\n")}`;
            task = found[0] ?? null;
          }
          if (!task || task.status !== "offen") return "Keine passende offene Aufgabe gefunden.";
          const next = await completeTask(task.id, today, now);
          actions.push({
            kind: "erledigt",
            title: task.title,
            detail: next ? `Nächste Wiederholung: ${germanDate(next.dueDate!)}` : undefined,
          });
          return `Erledigt: ${task.title}${next ? `. Nächste Wiederholung am ${germanDate(next.dueDate!)}.` : ""}`;
        }),
    }),
    betaZodTool({
      name: "termin_anlegen",
      description: "Trägt einen Termin in den eigenen Outlook-Kalender ein (ohne Einladungen).",
      inputSchema: z.object({
        titel: z.string().describe("z. B. „Server-Tausch bei Huber“"),
        start: z.string().describe("Lokale Zeit als JJJJ-MM-TTTHH:MM"),
        dauer_minuten: z
          .number()
          .int()
          .min(5)
          .max(24 * 60)
          .optional(),
        ort: z.string().optional(),
        kunde: z.string().optional(),
        notiz: z.string().optional(),
      }),
      run: (args) =>
        safe(async () => {
          const match = args.start.match(DATETIME);
          if (!match) return "Fehler: start muss JJJJ-MM-TTTHH:MM sein.";
          const start = zonedToUtc(match[1], match[2], workspace.timeZone);
          const minutes = args.dauer_minuten ?? workspace.defaultAppointmentMinutes;
          const end = new Date(start.getTime() + minutes * 60_000);
          const customer = args.kunde ? await findCustomer(args.kunde) : null;
          const when = `${germanDate(match[1])}, ${match[2]}–${localTime(end, workspace.timeZone)}`;
          if (!outlook) {
            const task = await createTask(
              { title: args.titel, notes: args.notiz, dueDate: match[1], dueTime: match[2], customerId: customer?.id, source: "assistent" },
              now,
            );
            actions.push({
              kind: "aufgabe",
              title: task.title,
              detail: `${when} · Outlook nicht verbunden, als Aufgabe`,
              href: "/app/aufgaben",
            });
            return `Outlook ist nicht verbunden – als Aufgabe mit Uhrzeit angelegt: ${when}.`;
          }
          const location = args.ort ?? customer?.address ?? null;
          const body = [args.notiz, customer ? `Kunde: ${customer.name}` : null].filter(Boolean).join("\n") || null;
          const event = await createEvent({ subject: args.titel, start, end, location, body });
          actions.push({
            kind: "termin",
            title: args.titel,
            detail: `${when}${location ? ` · ${location}` : ""}`,
            href: event.webLink ?? undefined,
          });
          return `Termin eingetragen: ${args.titel}, ${when}${location ? `, ${location}` : ""}.`;
        }),
    }),
    betaZodTool({
      name: "termine_anzeigen",
      description: "Zeigt Termine aus dem Outlook-Kalender in einem Zeitraum.",
      inputSchema: z.object({ von: z.string().describe("JJJJ-MM-TT"), bis: z.string().describe("JJJJ-MM-TT, einschließlich") }),
      run: (args) =>
        safe(async () => {
          if (!DATE.test(args.von) || !DATE.test(args.bis)) return "Fehler: Datum als JJJJ-MM-TT angeben.";
          if (!outlook) return "Outlook ist für dich nicht verbunden – keine Kalenderdaten.";
          const events = await listEvents(
            zonedToUtc(args.von, "00:00", workspace.timeZone),
            zonedToUtc(addDays(args.bis, 1), "00:00", workspace.timeZone),
          );
          if (events.length === 0) return "Keine Termine im Zeitraum.";
          return events
            .map((e) => {
              const day = localDate(e.start, workspace.timeZone);
              const time = e.isAllDay ? "ganztägig" : `${localTime(e.start, workspace.timeZone)}–${localTime(e.end, workspace.timeZone)}`;
              return `${germanDate(day)} ${time}: ${e.subject}${e.location ? ` (${e.location})` : ""}`;
            })
            .join("\n");
        }),
    }),
    betaZodTool({
      name: "email_entwurf",
      description: "Legt eine E-Mail als Entwurf in Outlook an. Empfänger als Adresse(n) oder Kundenname.",
      inputSchema: z.object({
        an: z.string().describe("E-Mail-Adresse(n), kommagetrennt, oder Name eines Kunden"),
        cc: z.string().optional(),
        betreff: z.string(),
        text: z.string().describe("Fertiger E-Mail-Text inkl. Anrede und Gruß"),
      }),
      run: (args) =>
        safe(async () => {
          const addresses = (value: string) => value.split(/[,;\s]+/).filter((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
          let to = addresses(args.an);
          if (to.length === 0) {
            const customer = await findCustomer(args.an);
            if (customer?.email) to = [customer.email];
            else return `Für „${args.an}“ ist keine E-Mail-Adresse hinterlegt. Frag nach der Adresse.`;
          }
          const cc = args.cc ? addresses(args.cc) : [];
          if (!outlook) {
            const href = `mailto:${to.join(",")}?${new URLSearchParams({ subject: args.betreff, body: args.text }).toString().replace(/\+/g, "%20")}`;
            actions.push({ kind: "entwurf", title: args.betreff, detail: `An ${to.join(", ")} · im Mailprogramm öffnen`, href });
            return "Outlook ist nicht verbunden – der Entwurf steht als Link zum Öffnen im Mailprogramm bereit.";
          }
          const draft = await createMailDraft({ to, cc, subject: args.betreff, body: args.text });
          actions.push({
            kind: "entwurf",
            title: args.betreff,
            detail: `An ${to.join(", ")} · liegt in Outlook unter „Entwürfe“`,
            href: draft.webLink ?? undefined,
          });
          return `Entwurf an ${to.join(", ")} liegt in Outlook unter „Entwürfe“.`;
        }),
    }),
    betaZodTool({
      name: "kunde_info",
      description: "Überblick zu einem Kunden: Kontakt, offene Tickets, Warnungen, Geräte, offene Aufgaben, Notizen.",
      inputSchema: z.object({ kunde: z.string() }),
      run: (args) =>
        safe(async () => {
          const customer = await findCustomer(args.kunde);
          if (!customer) return `Keinen Kunden „${args.kunde}“ gefunden.`;
          const [tickets, alerts, devices, tasks] = await Promise.all([
            listTickets({ customerId: customer.id }),
            listAlerts(customer.id),
            listDevices(customer.id),
            listTasks("alle", today, { customerId: customer.id }),
          ]);
          const offline = devices.filter((d) => d.online === false);
          return [
            `${customer.name}${customer.email ? `, ${customer.email}` : ""}${customer.phone ? `, ${customer.phone}` : ""}`,
            customer.notes ? `Notizen: ${customer.notes}` : null,
            `Zugangsdaten: ${customer.keeperUrl ? "in Keeper (Link beim Kunden)" : "kein Keeper-Link hinterlegt"}`,
            `Offene Tickets (${tickets.length}): ${tickets.map((t) => `#${t.id} ${t.title} [${TICKET_STATUS_LABELS[t.status] ?? t.status}${t.waitingForUs ? ", wartet auf uns" : ""}]`).join("; ") || "keine"}`,
            `Warnungen (${alerts.length}): ${
              alerts
                .slice(0, 10)
                .map((a) => `${a.severity ?? ""} ${a.title} (${a.deviceName ?? "?"})`)
                .join("; ") || "keine"
            }`,
            `Geräte: ${devices.length}, davon offline: ${offline.map((d) => d.name).join(", ") || "keins"}`,
            `Offene Aufgaben: ${tasks.map((t) => t.title).join("; ") || "keine"}`,
          ]
            .filter(Boolean)
            .join("\n");
        }),
    }),
    betaZodTool({
      name: "tickets_anzeigen",
      description: "Listet offene Atera-Tickets, optional für einen Kunden oder nur solche, die auf uns warten.",
      inputSchema: z.object({ kunde: z.string().optional(), nur_wartend: z.boolean().optional() }),
      run: (args) =>
        safe(async () => {
          const customer = args.kunde ? await findCustomer(args.kunde) : null;
          if (args.kunde && !customer) return `Keinen Kunden „${args.kunde}“ gefunden.`;
          const tickets = (await listTickets({ customerId: customer?.id })).filter((t) => !args.nur_wartend || t.waitingForUs);
          if (tickets.length === 0) return "Keine passenden offenen Tickets.";
          return tickets
            .slice(0, 40)
            .map(
              (t) =>
                `#${t.id} ${t.title} – ${t.customerName ?? "?"} [${TICKET_STATUS_LABELS[t.status] ?? t.status}, ${t.priority ?? "?"}${t.waitingForUs ? ", wartet auf uns" : ""}]`,
            )
            .join("\n");
        }),
    }),
    betaZodTool({
      name: "ticket_details",
      description: "Details und Verlauf eines Atera-Tickets.",
      inputSchema: z.object({ ticket_id: z.string() }),
      run: (args) =>
        safe(async () => {
          const ticket = await getTicket(args.ticket_id.replace(/^#/, ""));
          if (!ticket) return "Ticket nicht gefunden (nur offene Tickets sind gespiegelt).";
          const comments = ateraConfigured() ? await ateraTicketComments(ticket.id) : [];
          return [
            `#${ticket.id} ${ticket.title} – ${ticket.customerName ?? "?"}, Status ${TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}, Priorität ${ticket.priority ?? "?"}`,
            `Kontakt: ${[ticket.contactName, ticket.contactEmail, ticket.contactPhone].filter(Boolean).join(", ") || "unbekannt"}`,
            ...comments.slice(-8).map((c) => `--- ${c.date ?? ""} ${c.author}${c.internal ? " (intern)" : ""}:\n${c.text.slice(0, 1200)}`),
          ].join("\n");
        }),
    }),
    betaZodTool({
      name: "zeit_buchen",
      description: "Bucht Arbeitszeit bei einem Kunden – standardmäßig vom vorab bezahlten Stundenpaket.",
      inputSchema: z.object({
        kunde: z.string(),
        minuten: z
          .number()
          .int()
          .min(1)
          .max(24 * 60)
          .describe("Dauer in Minuten, z. B. 90 für 1,5 Stunden"),
        taetigkeit: z.string().describe("Was gemacht wurde, kurz"),
        datum: z.string().optional().describe("JJJJ-MM-TT, Standard heute"),
        art: z.enum(["kontingent", "verrechnen", "intern"]).optional().describe("kontingent = vom Stundenpaket (Standard)"),
        ticket_id: z.string().optional(),
      }),
      run: (args) =>
        safe(async () => {
          const customer = await findCustomer(args.kunde);
          if (!customer) return `Keinen Kunden „${args.kunde}“ gefunden.`;
          if (args.datum && !DATE.test(args.datum)) return "Fehler: datum muss JJJJ-MM-TT sein.";
          const entry = await addTimeEntry(
            {
              customerId: customer.id,
              date: args.datum || today,
              minutes: args.minuten,
              description: args.taetigkeit,
              mode: args.art ?? "kontingent",
              ticketId: args.ticket_id?.replace(/^#/, "") || null,
              source: "assistent",
            },
            now,
          );
          const account = await getAccount(customer.id, today.slice(0, 7));
          const rest = account && account.purchased > 0 ? `Reststand ${formatHours(account.balance)}` : "kein Stundenpaket hinterlegt";
          actions.push({
            kind: "zeit",
            title: `${formatHours(entry.minutes)} bei ${customer.name}`,
            detail: `${entry.description} · ${TIME_MODE_LABELS[entry.mode]} · ${rest}`,
            href: `/app/stunden/${customer.id}`,
          });
          return `Gebucht: ${formatHours(entry.minutes)} bei ${customer.name} (${TIME_MODE_LABELS[entry.mode]}). ${rest}.`;
        }),
    }),
    betaZodTool({
      name: "stundenkonto",
      description: "Reststand des Stundenpakets eines Kunden und die letzten Buchungen.",
      inputSchema: z.object({ kunde: z.string() }),
      run: (args) =>
        safe(async () => {
          const customer = await findCustomer(args.kunde);
          if (!customer) return `Keinen Kunden „${args.kunde}“ gefunden.`;
          const account = await getAccount(customer.id, today.slice(0, 7));
          if (!account) return `${customer.name} hat kein Stundenpaket und keine Buchungen.`;
          const entries = await listEntries({ customerId: customer.id, limit: 5 });
          return [
            account.purchased > 0
              ? `${customer.name}: ${formatHours(account.balance)} übrig (gekauft ${formatHours(account.purchased)}, verbraucht ${formatHours(account.used)})${account.status === "ueberzogen" ? " – überzogen!" : account.status === "knapp" ? " – wird knapp" : ""}`
              : `${customer.name}: kein Stundenpaket`,
            account.billableThisMonth > 0 ? `Diesen Monat separat zu verrechnen: ${formatHours(account.billableThisMonth)}` : null,
            "Letzte Buchungen:",
            ...entries.map((e) => `- ${germanDate(e.date)}: ${formatHours(e.minutes)} ${e.description} (${TIME_MODE_LABELS[e.mode]})`),
          ]
            .filter(Boolean)
            .join("\n");
        }),
    }),
    betaZodTool({
      name: "stunden_gutschreiben",
      description: "Schreibt einem Kunden vorab bezahlte Stunden gut (neues Stundenpaket).",
      inputSchema: z.object({
        kunde: z.string(),
        stunden: z.number().positive().max(1000),
        bezahlt_am: z.string().optional().describe("JJJJ-MM-TT, Standard heute"),
        betrag_euro: z.number().nonnegative().optional(),
        rechnung: z.string().optional().describe("Rechnungsnummer oder Notiz"),
      }),
      run: (args) =>
        safe(async () => {
          const customer = await findCustomer(args.kunde);
          if (!customer) return `Keinen Kunden „${args.kunde}“ gefunden.`;
          if (args.bezahlt_am && !DATE.test(args.bezahlt_am)) return "Fehler: bezahlt_am muss JJJJ-MM-TT sein.";
          await addPackage(
            {
              customerId: customer.id,
              minutes: Math.round(args.stunden * 60),
              date: args.bezahlt_am || today,
              priceCents: args.betrag_euro === undefined ? null : Math.round(args.betrag_euro * 100),
              reference: args.rechnung ?? null,
            },
            now,
          );
          const account = await getAccount(customer.id, today.slice(0, 7));
          actions.push({
            kind: "stunden",
            title: `+${formatHours(Math.round(args.stunden * 60))} für ${customer.name}`,
            detail: `Reststand jetzt ${formatHours(account?.balance ?? 0)}`,
            href: `/app/stunden/${customer.id}`,
          });
          return `${formatHours(Math.round(args.stunden * 60))} gutgeschrieben. Reststand ${customer.name}: ${formatHours(account?.balance ?? 0)}.`;
        }),
    }),
    betaZodTool({
      name: "doku_suchen",
      description:
        "Durchsucht die Kunden-Dokumentation: Patchliste (Dose, Raum, Patchfeld, Switchport, VLAN, Gerät), Patchschränke, Netzwerkgeräte und Doku-Seiten – und BookStack, falls verbunden.",
      inputSchema: z.object({
        suchbegriff: z.string().describe("Wenige Stichwörter, z. B. „Drucker 2. Stock“ oder „Gi1/0/12“"),
        kunde: z.string().optional(),
      }),
      run: (args) =>
        safe(async () => {
          const customer = args.kunde ? await findCustomer(args.kunde) : null;
          if (args.kunde && !customer) return `Keinen Kunden „${args.kunde}“ gefunden.`;
          const hits = await searchDocs(args.suchbegriff, customer?.id, 15);
          const lines = hits.map(
            (h) =>
              `[${{ port: "Verkabelung", rack: "Patchschrank", page: "Seite", network: "Netzwerk", record: "Kundenakte" }[h.kind]}] ${h.customerName}: ${h.title} – ${h.detail}`,
          );
          if (bookstackConfigured()) {
            try {
              const query = customer ? `${args.suchbegriff} ${customer.name}` : args.suchbegriff;
              for (const hit of (await searchBookStack(query, 5)).filter((h) => h.type === "page")) {
                lines.push(`[BookStack] ${hit.name}: ${(hit.preview_html?.content ?? "").replace(/<[^>]+>/g, "").slice(0, 200)}`);
              }
            } catch (error) {
              lines.push(`(BookStack nicht erreichbar: ${error instanceof Error ? error.message : String(error)})`);
            }
          }
          return lines.length ? lines.join("\n") : "In der Dokumentation nichts dazu gefunden.";
        }),
    }),
    betaZodTool({
      name: "dateien_suchen",
      description:
        "Sucht Dateien in OneDrive und SharePoint (Volltext, mit den Rechten der angemeldeten Person). Mit nur_wissensdatenbank=true nur in der Wissensdatenbank (SharePoint).",
      inputSchema: z.object({ suchbegriff: z.string(), nur_wissensdatenbank: z.boolean().optional() }),
      run: (args) =>
        safe(async () => {
          if (!user) return "Dateisuche ist nur mit Anmeldung möglich.";
          const site = workspace.knowledge.sharePointSiteUrl.trim();
          try {
            const hits = await searchFiles(user.id, args.suchbegriff, {
              sitePath: args.nur_wissensdatenbank && site ? site : undefined,
              size: 8,
            });
            if (!hits.length) return "Nichts gefunden.";
            actions.push({
              kind: "link",
              title: `Dateien: ${args.suchbegriff}`,
              href: `/app/wissen?q=${encodeURIComponent(args.suchbegriff)}`,
            });
            return hits
              .map(
                (h) =>
                  `${h.folder ? "[Ordner]" : "[Datei]"} ${h.name}${h.location ? ` (${h.location})` : ""} – ${h.webUrl}${h.summary ? `\n  ${h.summary}` : ""}`,
              )
              .join("\n");
          } catch (error) {
            if (error instanceof M365Error) return error.message;
            throw error;
          }
        }),
    }),
    betaZodTool({
      name: "fristen_anzeigen",
      description:
        "Zeigt Fristen: ablaufende Lizenzen, Kündigungstermine von Verträgen, Garantien, Domains, Zertifikate, fällige Backup-Tests und Schulungen.",
      inputSchema: z.object({ tage: z.number().int().min(1).max(365).optional(), kunde: z.string().optional() }),
      run: (args) =>
        safe(async () => {
          const customer = args.kunde ? await findCustomer(args.kunde) : null;
          if (args.kunde && !customer) return `Keinen Kunden „${args.kunde}“ gefunden.`;
          const items = (await allDeadlines(args.tage ?? 60, now)).filter((d) => !customer || d.customerId === customer.id);
          if (!items.length) return "In diesem Zeitraum ist nichts fällig.";
          actions.push({ kind: "link", title: "Fristen", href: "/app/fristen" });
          return items.map((d) => `${d.dueAt}: ${d.label} – ${d.title ?? d.kind} (${d.customerName})`).join("\n");
        }),
    }),
    betaZodTool({
      name: "netzwerk_pruefen",
      description:
        "Prüft die Netzwerkdokumentation eines Kunden (WAN, Netze/VLANs, DHCP, IPs, Verbindungen) und nennt Fehler und Hinweise – wie ein Konfigurations-Check.",
      inputSchema: z.object({ kunde: z.string() }),
      run: (args) =>
        safe(async () => {
          const customer = await findCustomer(args.kunde);
          if (!customer) return `Keinen Kunden „${args.kunde}“ gefunden.`;
          const model = await loadNetwork(customer.id);
          if (!model.devices.length && !model.networks.length) return `Für ${customer.name} ist noch kein Netzwerk dokumentiert.`;
          actions.push({ kind: "link", title: `Netzwerk ${customer.name}`, href: `/app/kunden/${customer.id}/doku/netzwerk` });
          const findings = checkNetwork(model);
          const size = `${model.devices.length} ${model.devices.length === 1 ? "Gerät" : "Geräte"}, ${model.networks.length} ${model.networks.length === 1 ? "Netz" : "Netze"}`;
          if (!findings.length) return `Netzwerk ${customer.name}: ${size} – keine Fehler oder Hinweise.`;
          return [
            `Netzwerk ${customer.name}: ${size}.`,
            ...findings.map((f) => `[${f.level}] ${f.message}${f.hint ? ` → ${f.hint}` : ""}`),
          ].join("\n");
        }),
    }),
  ];
}

export async function runAssistant(history: AssistantTurn[], now = new Date(), user: AssistantUser | null = null): Promise<AssistantReply> {
  // Ohne Angabe (z. B. in Tests) wie bisher: Postfach der Inhaberin bzw. des Inhabers.
  const outlook = outlookConfigured() && (user === null || user.role === "inhaber");
  const actions: AssistantAction[] = [];
  const messages = toMessages(history);
  if (messages.length === 0) return { text: "Was kann ich für dich tun?", actions };
  try {
    const final = await client().beta.messages.toolRunner({
      // Kein serverseitiger Gesprächszustand bei Anthropic; der Verlauf kommt bei jedem Aufruf mit.
      thread: false,
      cache_control: { type: "ephemeral" },
      model: MODEL,
      max_tokens: 4096,
      max_iterations: 8,
      output_config: { effort: "low" },
      ...fallbackOptions(MODEL),
      system: await systemPrompt(now, user, outlook),
      messages,
      tools: buildTools(now, actions, user, outlook),
    });
    if (final.stop_reason === "refusal") return { text: "Das kann ich leider nicht übernehmen.", actions };
    const text = final.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n\n")
      .trim();
    return { text: text || (actions.length ? "Erledigt." : "Ich habe dazu gerade keine Antwort."), actions };
  } catch (error) {
    console.error("Assistent fehlgeschlagen:", error);
    const message =
      error instanceof Anthropic.AuthenticationError
        ? "Der KI-Zugang ist ungültig (ANTHROPIC_API_KEY prüfen)."
        : error instanceof Anthropic.RateLimitError
          ? "Die KI ist gerade ausgelastet – bitte gleich nochmal."
          : "Die KI ist gerade nicht erreichbar.";
    return { text: actions.length ? `${message} Bis dahin erledigt: ${actions.map((a) => a.title).join(", ")}.` : message, actions };
  }
}
