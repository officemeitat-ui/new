"""E-Mail-Anbindung für den KI-Mitarbeiter: Postfach abrufen (IMAP) und Antworten senden (SMTP).

Nur Python-Standardbibliothek. Funktioniert mit jedem Postfach, das IMAP/SMTP spricht
(Microsoft 365 mit App-Kennwort/SMTP-AUTH, World4You, A1, Gmail, eigener Mailserver …).
"""

from __future__ import annotations

import email
import html
import imaplib
import re
import smtplib
import ssl
from dataclasses import dataclass, field
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import make_msgid, parseaddr

from .config import Settings

MAX_BODY = 20000


@dataclass
class ParsedMail:
    message_id: str
    from_name: str
    from_email: str
    subject: str
    body: str
    attachments: list[str] = field(default_factory=list)
    attachment_text: str = ""
    handle: str = ""  # anbieterspezifische ID (z. B. Microsoft-Graph-Nachrichten-ID) für Antworten im Verlauf
    files: list[tuple[str, bytes]] = field(default_factory=list)  # PDF-Anhänge (für die Belegablage)
    other_files: list[tuple[str, bytes]] = field(default_factory=list)  # übrige Anhänge (Screenshots, Dokumente)
    in_reply_to: str = ""  # Antwort auf welche Mail? (Zuordnung zum bestehenden Ticket)


@dataclass
class Attachment:
    name: str
    data: bytes
    content_type: str = "application/octet-stream"
    inline_id: str = ""  # gesetzt → eingebettetes Bild (z. B. Logo im Mailkopf)


def _decode(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except (UnicodeDecodeError, LookupError, ValueError):
        return value


def html_to_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", markup)
    markup = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h\d)>", "\n", markup)
    text = html.unescape(re.sub(r"<[^>]+>", " ", markup))
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def strip_quoted(text: str) -> str:
    """Entfernt zitierte Vorgänger-Mails ("> …", "Am … schrieb …"), damit die KI nur Neues liest."""
    out = []
    for line in text.splitlines():
        if re.match(r"^\s*>", line):
            continue
        if re.match(r"^\s*(Am .+ schrieb .+:|On .+ wrote:|-{2,}\s*Original|Von:\s.+|From:\s.+)$", line):
            break
        out.append(line)
    return "\n".join(out).strip()


def _pdf_text(data: bytes) -> str:
    try:
        from io import BytesIO

        from pypdf import PdfReader  # optional: pip install pypdf
    except ImportError:
        return ""
    try:
        reader = PdfReader(BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages[:5])[:8000]
    except Exception:  # noqa: BLE001 - kaputte PDFs dürfen den Abruf nicht stoppen
        return ""


def parse_raw(raw: bytes) -> ParsedMail:
    msg = email.message_from_bytes(raw)
    name, addr = parseaddr(_decode(msg.get("From")))
    plain, markup, attachments, attachment_text, files, other = [], [], [], [], [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        filename = _decode(part.get_filename())
        ctype = part.get_content_type()
        payload = part.get_payload(decode=True) or b""
        if filename or part.get_content_disposition() == "attachment":
            attachments.append(filename or ctype)
            if ctype == "application/pdf" or filename.lower().endswith(".pdf"):
                attachment_text.append(_pdf_text(payload))
                if payload and len(payload) <= 20 * 1024 * 1024:
                    files.append((filename or "anhang.pdf", payload))
            elif payload and len(payload) <= 20 * 1024 * 1024:
                other.append((filename or f"anhang.{ctype.rsplit('/', 1)[-1]}", payload))
            continue
        charset = part.get_content_charset() or "utf-8"
        try:
            text = payload.decode(charset, errors="replace")
        except LookupError:
            text = payload.decode("utf-8", errors="replace")
        if ctype == "text/plain":
            plain.append(text)
        elif ctype == "text/html":
            markup.append(text)
    body = "\n".join(plain) if plain else html_to_text("\n".join(markup))
    return ParsedMail(
        message_id=(msg.get("Message-ID") or "").strip(),
        from_name=name.strip(),
        from_email=addr.strip().lower(),
        subject=_decode(msg.get("Subject")).strip(),
        body=strip_quoted(body)[:MAX_BODY],
        attachments=attachments,
        attachment_text="\n".join(t for t in attachment_text if t)[:8000],
        files=files,
        other_files=other,
        in_reply_to=(msg.get("In-Reply-To") or "").strip().split()[0] if (msg.get("In-Reply-To") or "").strip() else "",
    )


class MailError(RuntimeError):
    pass


class Mailer:
    """IMAP/SMTP (jeder klassische Mailanbieter)."""

    provider = "imap"

    def __init__(self, settings: Settings):
        self.s = settings

    @property
    def imap_configured(self) -> bool:
        return bool(self.s.mail_imap_host and self.s.mail_imap_user and self.s.mail_imap_password)

    @property
    def smtp_configured(self) -> bool:
        return bool(self.s.mail_smtp_host and self.s.mail_from)

    def fetch_unseen(self, limit: int = 25) -> list[ParsedMail]:
        """Holt ungelesene Mails (werden dabei als gelesen markiert)."""
        if not self.imap_configured:
            raise MailError("IMAP ist nicht konfiguriert (MAIL_IMAP_HOST/USER/PASSWORD in .env).")
        try:
            with imaplib.IMAP4_SSL(self.s.mail_imap_host, self.s.mail_imap_port,
                                   ssl_context=ssl.create_default_context(), timeout=30) as imap:
                imap.login(self.s.mail_imap_user, self.s.mail_imap_password)
                imap.select(self.s.mail_imap_folder)
                status, data = imap.search(None, "UNSEEN")
                if status != "OK":
                    raise MailError("IMAP-Suche fehlgeschlagen")
                ids = data[0].split()[-limit:]
                mails = []
                for num in ids:
                    status, parts = imap.fetch(num, "(RFC822)")
                    if status == "OK" and parts and isinstance(parts[0], tuple):
                        mails.append(parse_raw(parts[0][1]))
                return mails
        except (imaplib.IMAP4.error, OSError) as exc:
            raise MailError(f"IMAP-Fehler: {exc}") from exc

    def send(self, to: str, subject: str, body: str, in_reply_to: str = "", reply_handle: str = "",
             attachments: list[Attachment] | None = None, html: str = "", cc: str = "") -> str:
        if not self.smtp_configured:
            raise MailError("SMTP ist nicht konfiguriert (MAIL_SMTP_HOST/MAIL_FROM in .env).")
        if not to or "@" not in to:
            raise MailError("Keine gültige Empfängeradresse.")
        msg = EmailMessage()
        msg["From"] = self.s.mail_from
        msg["To"] = to
        if cc:
            msg["Cc"] = cc
        msg["Subject"] = subject
        msg_id = make_msgid(domain=self.s.mail_from.split("@")[-1] or "localhost")
        msg["Message-ID"] = msg_id
        if in_reply_to:
            msg["In-Reply-To"] = in_reply_to
            msg["References"] = in_reply_to
        msg.set_content(body)
        inline = [a for a in (attachments or []) if a.inline_id]
        if html:
            msg.add_alternative(html, subtype="html")
            html_part = msg.get_payload()[-1]
            for a in inline:
                maintype, _, subtype = a.content_type.partition("/")
                html_part.add_related(a.data, maintype=maintype, subtype=subtype, cid=f"<{a.inline_id}>",
                                      filename=a.name)
        for a in attachments or []:
            if a.inline_id:
                continue
            maintype, _, subtype = a.content_type.partition("/")
            msg.add_attachment(a.data, maintype=maintype or "application", subtype=subtype or "octet-stream",
                               filename=a.name)
        try:
            if self.s.mail_smtp_port == 465:
                server = smtplib.SMTP_SSL(self.s.mail_smtp_host, 465, timeout=30,
                                          context=ssl.create_default_context())
            else:
                server = smtplib.SMTP(self.s.mail_smtp_host, self.s.mail_smtp_port, timeout=30)
                server.starttls(context=ssl.create_default_context())
            with server:
                if self.s.mail_smtp_user and self.s.mail_smtp_password:
                    server.login(self.s.mail_smtp_user, self.s.mail_smtp_password)
                server.send_message(msg)
        except (smtplib.SMTPException, OSError) as exc:
            raise MailError(f"SMTP-Fehler: {exc}") from exc
        return msg_id


class GraphMailer:
    """Microsoft 365 über Microsoft Graph (App-Registrierung, Client-Credentials).

    Benötigte Anwendungsberechtigungen: Mail.ReadWrite und Mail.Send (Admin-Zustimmung),
    Zugriff am besten per Exchange-Online-Richtlinie auf das eine Postfach beschränken.
    """

    provider = "graph"
    GRAPH = "https://graph.microsoft.com/v1.0"

    def __init__(self, settings: Settings):
        from .msauth import TokenSource

        self.s = settings
        self.auth = TokenSource(settings.graph_tenant_id, settings.graph_client_id, settings.graph_client_secret)

    @property
    def configured(self) -> bool:
        from .msauth import has_credential

        return bool(self.s.graph_tenant_id and self.s.graph_client_id and has_credential(self.s.graph_client_secret)
                    and self.s.graph_mailbox)

    imap_configured = property(lambda self: self.configured)
    smtp_configured = property(lambda self: self.configured)

    def _headers(self) -> dict[str, str]:
        from .msauth import MsAuthError

        if not self.configured:
            raise MailError("Microsoft 365 ist nicht konfiguriert (GRAPH_TENANT_ID/CLIENT_ID, Zertifikat oder "
                            "CLIENT_SECRET, GRAPH_MAILBOX).")
        try:
            return self.auth.headers()
        except MsAuthError as exc:
            raise MailError(str(exc)) from exc

    def _url(self, path: str) -> str:
        from urllib.parse import quote

        return f"{self.GRAPH}/users/{quote(self.s.graph_mailbox)}{path}"

    def _request(self, method: str, path: str, **kwargs):
        import httpx

        try:
            resp = httpx.request(method, self._url(path), headers={**self._headers(), **kwargs.pop("headers", {})},
                                 timeout=30, **kwargs)
            resp.raise_for_status()
            return resp
        except httpx.HTTPStatusError as exc:
            detail = ""
            try:
                detail = exc.response.json().get("error", {}).get("message", "")
            except Exception:  # noqa: BLE001
                pass
            raise MailError(f"Microsoft Graph {exc.response.status_code}: {detail or exc}") from exc
        except httpx.HTTPError as exc:
            raise MailError(f"Microsoft Graph nicht erreichbar: {exc}") from exc

    def fetch_unseen(self, limit: int = 25) -> list[ParsedMail]:
        folder = self.s.mail_imap_folder if self.s.mail_imap_folder.upper() != "INBOX" else "inbox"
        resp = self._request(
            "GET", f"/mailFolders/{folder}/messages",
            # Hinweis: $orderby zusammen mit $filter lehnt Graph oft ab ("too complex") – daher ohne Sortierung.
            params={"$filter": "isRead eq false", "$top": str(limit),
                    "$select": "id,internetMessageId,subject,from,body,hasAttachments,internetMessageHeaders"},
            headers={"Prefer": 'outlook.body-content-type="text"'},
        )
        mails = []
        for item in resp.json().get("value", []):
            sender = (item.get("from") or {}).get("emailAddress") or {}
            attachments, attachment_text, files, other = [], [], [], []
            if item.get("hasAttachments"):
                att = self._request("GET", f"/messages/{item['id']}/attachments",
                                    params={"$select": "name,contentType,size"}).json().get("value", [])
                for a in att:
                    attachments.append(a.get("name") or a.get("contentType") or "Anhang")
                    if (a.get("size") or 0) < 5_000_000 and a.get("id") and \
                            a.get("@odata.type", "#microsoft.graph.fileAttachment") == "#microsoft.graph.fileAttachment":
                        full = self._request("GET", f"/messages/{item['id']}/attachments/{a['id']}").json()
                        if full.get("contentBytes"):
                            import base64

                            data = base64.b64decode(full["contentBytes"])
                            name = a.get("name") or "anhang"
                            if name.lower().endswith(".pdf") or data[:4] == b"%PDF":
                                attachment_text.append(_pdf_text(data))
                                files.append((name, data))
                            else:
                                other.append((name, data))
            headers = {h.get("name", "").lower(): h.get("value", "") for h in item.get("internetMessageHeaders") or []}
            body = (item.get("body") or {}).get("content") or ""
            if (item.get("body") or {}).get("contentType", "").lower() == "html":
                body = html_to_text(body)
            mails.append(ParsedMail(
                message_id=item.get("internetMessageId") or item["id"], from_name=sender.get("name", ""),
                from_email=(sender.get("address") or "").lower(), subject=item.get("subject") or "",
                body=strip_quoted(body)[:MAX_BODY], attachments=attachments,
                attachment_text="\n".join(t for t in attachment_text if t)[:8000], handle=item["id"],
                files=files, other_files=other, in_reply_to=(headers.get("in-reply-to") or "").strip(),
            ))
            self._request("PATCH", f"/messages/{item['id']}", json={"isRead": True})
        return mails

    def free_slots(self, count: int = 3, duration_min: int = 30, days: int = 7, start_hour: int = 9,
                   end_hour: int = 16, now=None) -> list:
        """Freie Termine aus dem M365-Kalender des Postfachs (benötigt Calendars.Read). Max. ein Vorschlag pro Tag."""
        from datetime import datetime, time as dtime, timedelta

        now = now or datetime.now()
        window_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        window_end = window_start + timedelta(days=days + 3)
        resp = self._request("GET", "/calendarView", params={
            "startDateTime": window_start.isoformat(), "endDateTime": window_end.isoformat(),
            "$select": "start,end,showAs", "$top": "250"},
            headers={"Prefer": 'outlook.timezone="W. Europe Standard Time"'})

        def parse(v: dict) -> datetime:
            return datetime.fromisoformat((v.get("dateTime") or "")[:19])

        busy = [(parse(e["start"]), parse(e["end"])) for e in resp.json().get("value", [])
                if e.get("showAs", "busy") not in ("free", "workingElsewhere")]
        earliest = now + timedelta(hours=2)
        dur = timedelta(minutes=duration_min)
        slots = []
        day = now.date()
        while len(slots) < count and day <= window_end.date():
            if day.weekday() < 5:
                t = datetime.combine(day, dtime(start_hour))
                while t + dur <= datetime.combine(day, dtime(end_hour)):
                    if t >= earliest and not any(b0 < t + dur and t < b1 for b0, b1 in busy):
                        slots.append(t)
                        break
                    t += timedelta(minutes=30)
            day += timedelta(days=1)
        return slots

    def send(self, to: str, subject: str, body: str, in_reply_to: str = "", reply_handle: str = "",
             attachments: list[Attachment] | None = None, html: str = "", cc: str = "") -> str:
        import base64

        if not to or "@" not in to:
            raise MailError("Keine gültige Empfängeradresse.")
        if reply_handle and not attachments and not html:
            # Antwort im selben Verlauf (Outlook zeigt sie als Konversation)
            self._request("POST", f"/messages/{reply_handle}/reply", json={"comment": body})
            return ""
        message: dict = {"subject": subject,
                         "body": {"contentType": "HTML", "content": html} if html else {"contentType": "Text", "content": body},
                         "toRecipients": [{"emailAddress": {"address": to}}]}
        if cc:
            message["ccRecipients"] = [{"emailAddress": {"address": a.strip()}} for a in cc.split(",") if a.strip()]
        if attachments:
            message["attachments"] = [{
                "@odata.type": "#microsoft.graph.fileAttachment", "name": a.name, "contentType": a.content_type,
                "contentBytes": base64.b64encode(a.data).decode(), **({"isInline": True, "contentId": a.inline_id} if a.inline_id else {}),
            } for a in attachments]
        self._request("POST", "/sendMail", json={"message": message, "saveToSentItems": True})
        return ""


def make_mailer(settings: Settings):
    """Wählt die Postfach-Anbindung: MAIL_PROVIDER=graph (Microsoft 365) oder imap (Standard)."""
    return GraphMailer(settings) if settings.mail_provider == "graph" else Mailer(settings)
