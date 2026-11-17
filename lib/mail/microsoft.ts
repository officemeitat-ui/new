import "server-only";
import type { Email, IncomingEmail, MailAttachment } from "@/lib/emails";
import { createGraphClient, type GraphCredentials } from "@/lib/graph";
import type { DraftState, Mailbox } from "@/lib/mail/mailbox";

// Postfach in Microsoft 365 (Exchange Online) über Microsoft Graph.
// Benötigt nur „Mail.ReadWrite“ für genau dieses Postfach – bewusst ohne „Mail.Send“:
// Der Assistent kann Entwürfe anlegen, aber technisch keine E-Mail versenden.

const TEXT_BODY = 'IdType="ImmutableId", outlook.body-content-type="text"';
const MAX_MESSAGES = 500;
const THREAD_MESSAGES = 4;
const THREAD_CHARS = 1500;

type GraphAddress = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  from?: GraphAddress;
  receivedDateTime?: string;
  sentDateTime?: string;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
  conversationId?: string;
  sensitivity?: string;
  isDraft?: boolean;
  internetMessageHeaders?: { name: string; value: string }[];
};
type Page<T> = { value?: T[]; "@odata.nextLink"?: string };

/** OData-Zeichenkette: einfache Anführungszeichen verdoppeln. */
const odata = (value: string) => `'${value.replace(/'/g, "''")}'`;
const isoSeconds = (date: Date) => date.toISOString().replace(/\.\d+Z$/, "Z");

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Setzt den Antworttext über den zitierten Verlauf, den Outlook in den Entwurf schreibt. */
export function prependReply(body: { contentType?: string; content?: string }, text: string): { contentType: string; content: string } {
  const contentType = body.contentType?.toLowerCase() === "html" ? "html" : "text";
  const existing = body.content ?? "";
  if (contentType === "text") return { contentType, content: `${text}\n\n${existing}` };
  const html = `<div>${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div><br>`;
  const bodyTag = existing.match(/<body[^>]*>/i);
  if (!bodyTag || bodyTag.index === undefined) return { contentType, content: `${html}${existing}` };
  const at = bodyTag.index + bodyTag[0].length;
  return { contentType, content: `${existing.slice(0, at)}${html}${existing.slice(at)}` };
}

export function toIncomingEmail(message: GraphMessage): IncomingEmail | null {
  const address = message.from?.emailAddress?.address;
  if (!address) return null;
  const header = (name: string) => message.internetMessageHeaders?.find((h) => h.name.toLowerCase() === name)?.value;
  const autoSubmitted = (header("auto-submitted") ?? "no").toLowerCase();
  return {
    messageId: message.internetMessageId || `<${message.id}@graph>`,
    fromAddress: address,
    fromName: message.from?.emailAddress?.name || null,
    subject: message.subject || "(ohne Betreff)",
    body: (message.body?.content ?? "").trim(),
    receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
    autoSubmitted: autoSubmitted !== "no",
    externalId: message.id,
    conversationId: message.conversationId,
    hasAttachments: Boolean(message.hasAttachments),
    confidential: message.sensitivity === "private" || message.sensitivity === "confidential",
  };
}

export function microsoftMailbox(
  credentials: GraphCredentials,
  user: string,
  lookbackDays = Number(process.env.MS_MAIL_LOOKBACK_DAYS || 2),
): Mailbox {
  const graph = createGraphClient(credentials);
  const base = `/users/${encodeURIComponent(user)}`;
  const message = (id: string) => `${base}/messages/${encodeURIComponent(id)}`;
  const folderIds = new Map<string, string>();

  async function folderId(path: string): Promise<string> {
    const known = folderIds.get(path);
    if (known) return known;
    let parent = "msgfolderroot";
    for (const name of path
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const params = new URLSearchParams({ $filter: `displayName eq ${odata(name)}`, $select: "id,displayName" });
      const children = `${base}/mailFolders/${encodeURIComponent(parent)}/childFolders`;
      const found = await graph.json<Page<{ id: string }>>(`${children}?${params}`);
      parent =
        found.value?.[0]?.id ??
        (await graph.json<{ id: string }>(children, { method: "POST", body: JSON.stringify({ displayName: name }) })).id;
    }
    folderIds.set(path, parent);
    return parent;
  }

  /** E-Mails eines Gesprächs – im ganzen Postfach oder nur in einem Ordner (z. B. „sentitems“). */
  async function conversation(conversationId: string, folder?: string): Promise<GraphMessage[]> {
    const params = new URLSearchParams({
      $filter: `conversationId eq ${odata(conversationId)}`,
      $select: "id,from,receivedDateTime,sentDateTime,body,isDraft",
      $top: "25",
    });
    const scope = folder ? `${base}/mailFolders/${encodeURIComponent(folder)}/messages` : `${base}/messages`;
    const page = await graph.json<Page<GraphMessage>>(`${scope}?${params}`, { headers: { Prefer: TEXT_BODY } });
    return page.value ?? [];
  }

  return {
    kind: "microsoft",
    label: `Microsoft 365 (${user})`,

    async fetchRecent() {
      const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
      const params = new URLSearchParams({
        $filter: `receivedDateTime ge ${isoSeconds(since)}`,
        $orderby: "receivedDateTime asc",
        $select: "id,internetMessageId,subject,from,receivedDateTime,body,hasAttachments,conversationId,sensitivity,internetMessageHeaders",
        $top: "50",
      });
      const emails: IncomingEmail[] = [];
      let url: string | undefined = `${base}/mailFolders/inbox/messages?${params}`;
      while (url && emails.length < MAX_MESSAGES) {
        const page: Page<GraphMessage> = await graph.json(url, { headers: { Prefer: TEXT_BODY } });
        for (const item of page.value ?? []) {
          const email = toIncomingEmail(item);
          if (email) emails.push(email);
        }
        url = page["@odata.nextLink"];
      }
      return emails;
    },

    async attachments(externalId) {
      type GraphAttachment = { "@odata.type"?: string; name?: string; contentType?: string; isInline?: boolean; contentBytes?: string };
      const page = await graph.json<Page<GraphAttachment>>(`${message(externalId)}/attachments`);
      return (page.value ?? [])
        .filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment" && !a.isInline && a.contentBytes)
        .map(
          (a): MailAttachment => ({
            name: a.name || "anhang",
            contentType: a.contentType || "application/octet-stream",
            content: Buffer.from(a.contentBytes!, "base64"),
          }),
        );
    },

    async thread(email) {
      if (!email.conversationId) return null;
      const received = new Date(email.receivedAt).getTime();
      const earlier = (await conversation(email.conversationId))
        .filter((m) => m.id !== email.externalId && !m.isDraft)
        .map((m) => ({ m, at: new Date(m.receivedDateTime ?? m.sentDateTime ?? 0).getTime() }))
        .filter(({ at }) => at < received)
        .sort((a, b) => a.at - b.at)
        .slice(-THREAD_MESSAGES);
      if (earlier.length === 0) return null;
      return earlier
        .map(({ m, at }) => {
          const from = m.from?.emailAddress?.name || m.from?.emailAddress?.address || "unbekannt";
          const text = (m.body?.content ?? "").trim();
          return `--- ${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC, von ${from} ---\n${text.length > THREAD_CHARS ? `${text.slice(0, THREAD_CHARS)} …` : text}`;
        })
        .join("\n\n");
    },

    async createReplyDraft(email, text) {
      if (!email.externalId) throw new Error("E-Mail ohne Postfach-ID");
      const draft = await graph.json<GraphMessage>(`${message(email.externalId)}/createReply`, { method: "POST", body: "{}" });
      await graph.request(message(draft.id), { method: "PATCH", body: JSON.stringify({ body: prependReply(draft.body ?? {}, text) }) });
      return draft.id;
    },

    async file(email, categories, folder) {
      if (!email.externalId) return;
      if (categories.length > 0) {
        const current = await graph.json<{ categories?: string[] }>(`${message(email.externalId)}?$select=categories`);
        const merged = [...new Set([...(current.categories ?? []), ...categories])];
        if (merged.length !== (current.categories ?? []).length) {
          await graph.request(message(email.externalId), { method: "PATCH", body: JSON.stringify({ categories: merged }) });
        }
      }
      if (folder) {
        const destinationId = await folderId(folder);
        await graph.request(`${message(email.externalId)}/move`, { method: "POST", body: JSON.stringify({ destinationId }) });
      }
    },

    async draftState(email): Promise<DraftState> {
      if (!email.draftId) return "offen";
      const response = await graph.request(`${message(email.draftId)}?$select=isDraft`, { allow404: true });
      if (response.status !== 404) return ((await response.json()) as GraphMessage).isDraft ? "offen" : "gesendet";
      // Entwurf ist weg: entweder versendet (liegt dann mit neuer ID in „Gesendete Elemente“) oder gelöscht.
      if (!email.conversationId) return "verworfen";
      const since = new Date(email.draftCreatedAt ?? email.receivedAt).getTime();
      const sent = (await conversation(email.conversationId, "sentitems")).some(
        (m) => !m.isDraft && m.sentDateTime && new Date(m.sentDateTime).getTime() >= since,
      );
      return sent ? "gesendet" : "verworfen";
    },
  };
}
