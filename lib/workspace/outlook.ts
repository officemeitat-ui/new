import "server-only";
import { workspace } from "@/config/workspace";
import { createGraphClient, graphCredentials, type GraphClient } from "@/lib/graph";
import { importTask, type TaskPriority } from "@/lib/workspace/tasks";

// Outlook für den eigenen Arbeitsplatz: Kalender lesen und Termine eintragen, E-Mail-Entwürfe anlegen, Microsoft To Do übernehmen.
// Gleiche App-Registrierung wie Postfach und Kalender (MS_*). Entwürfe werden nie automatisch gesendet.

export type CalendarEntry = {
  id: string;
  subject: string;
  start: Date;
  end: Date;
  location: string | null;
  isAllDay: boolean;
  webLink: string | null;
};

let cached: { key: string; client: GraphClient } | undefined;

function graph(): { client: GraphClient; calendarUser: string; mailUser: string } | null {
  const credentials = graphCredentials();
  const calendarUser = process.env.MS_CALENDAR_USER || process.env.MS_MAILBOX;
  const mailUser = process.env.MS_MAILBOX || process.env.MS_CALENDAR_USER;
  if (!credentials || !calendarUser || !mailUser) return null;
  const key = `${credentials.tenantId}:${credentials.clientId}`;
  if (cached?.key !== key) cached = { key, client: createGraphClient(credentials) };
  return { client: cached.client, calendarUser, mailUser };
}

export const outlookConfigured = () => graph() !== null;

const user = (address: string) => `/users/${encodeURIComponent(address)}`;
const utc = (value?: { dateTime?: string }) => new Date(`${(value?.dateTime ?? "").replace(/\.\d+$/, "")}Z`);
const graphTime = (date: Date) => ({ dateTime: date.toISOString().replace(/\.\d+Z$/, ""), timeZone: "UTC" });

export async function listEvents(from: Date, to: Date): Promise<CalendarEntry[]> {
  const g = graph();
  if (!g) return [];
  type GraphEvent = {
    id: string;
    subject?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    location?: { displayName?: string };
    isAllDay?: boolean;
    isCancelled?: boolean;
    webLink?: string;
  };
  const params = new URLSearchParams({
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
    $select: "id,subject,start,end,location,isAllDay,isCancelled,webLink",
    $orderby: "start/dateTime",
    $top: "100",
  });
  const page = await g.client.json<{ value?: GraphEvent[] }>(`${user(g.calendarUser)}/calendar/calendarView?${params}`, {
    headers: { Prefer: 'outlook.timezone="UTC"' },
  });
  return (page.value ?? [])
    .filter((e) => !e.isCancelled)
    .map((e) => ({
      id: e.id,
      subject: e.subject || "(ohne Betreff)",
      start: utc(e.start),
      end: utc(e.end),
      location: e.location?.displayName || null,
      isAllDay: Boolean(e.isAllDay),
      webLink: e.webLink ?? null,
    }));
}

/** Trägt einen Termin in den eigenen Outlook-Kalender ein (ohne Teilnehmer – es gehen keine Einladungen raus). */
export async function createEvent(event: { subject: string; start: Date; end: Date; location?: string | null; body?: string | null }) {
  const g = graph();
  if (!g) throw new Error("Outlook ist nicht verbunden");
  const created = await g.client.json<{ id: string; webLink?: string }>(`${user(g.calendarUser)}/calendar/events`, {
    method: "POST",
    body: JSON.stringify({
      subject: event.subject,
      start: graphTime(event.start),
      end: graphTime(event.end),
      ...(event.location ? { location: { displayName: event.location } } : {}),
      ...(event.body ? { body: { contentType: "text", content: event.body } } : {}),
      showAs: "busy",
    }),
  });
  return { id: created.id, webLink: created.webLink ?? null };
}

/** Legt eine neue E-Mail als Entwurf in Outlook an (Ordner „Entwürfe“). Gesendet wird von dir, nicht vom Assistenten. */
export async function createMailDraft(draft: { to: string[]; cc?: string[]; subject: string; body: string }) {
  const g = graph();
  if (!g) throw new Error("Outlook ist nicht verbunden");
  const recipients = (list: string[] = []) => list.map((address) => ({ emailAddress: { address } }));
  const created = await g.client.json<{ id: string; webLink?: string }>(`${user(g.mailUser)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      subject: draft.subject,
      body: { contentType: "text", content: draft.body },
      toRecipients: recipients(draft.to),
      ccRecipients: recipients(draft.cc),
    }),
  });
  return { id: created.id, webLink: created.webLink ?? null };
}

/** Übernimmt offene Aufgaben aus Microsoft To Do (einmalig je Aufgabe; Listen werden zu Aufgabenlisten). */
export async function importTodoTasks(now = new Date()): Promise<{ lists: number; imported: number }> {
  const g = graph();
  if (!g) throw new Error("Outlook ist nicht verbunden");
  type TodoList = { id: string; displayName: string; wellknownListName?: string };
  type TodoTask = {
    id: string;
    title: string;
    body?: { content?: string };
    importance?: string;
    dueDateTime?: { dateTime?: string };
  };
  const lists = (await g.client.json<{ value?: TodoList[] }>(`${user(g.calendarUser)}/todo/lists`)).value ?? [];
  let imported = 0;
  for (const list of lists) {
    const listName = list.wellknownListName === "defaultList" ? workspace.lists[0] : list.displayName;
    let url: string | undefined =
      `${user(g.calendarUser)}/todo/lists/${encodeURIComponent(list.id)}/tasks?${new URLSearchParams({ $filter: "status ne 'completed'", $top: "100" })}`;
    while (url) {
      const page: { value?: TodoTask[]; "@odata.nextLink"?: string } = await g.client.json(url);
      for (const task of page.value ?? []) {
        const priority: TaskPriority = task.importance === "high" ? "hoch" : task.importance === "low" ? "niedrig" : "normal";
        const notes = task.body?.content?.trim() || null;
        const added = await importTask(
          {
            title: task.title,
            notes,
            listName,
            dueDate: task.dueDateTime?.dateTime?.slice(0, 10) ?? null,
            priority,
            source: "todo",
            externalId: `todo:${task.id}`,
          },
          now,
        );
        if (added) imported++;
      }
      url = page["@odata.nextLink"];
    }
  }
  return { lists: lists.length, imported };
}
