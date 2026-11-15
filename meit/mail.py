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
    plain, markup, attachments, attachment_text = [], [], [], []
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
    )


class MailError(RuntimeError):
    pass


class Mailer:
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

    def send(self, to: str, subject: str, body: str, in_reply_to: str = "") -> str:
        if not self.smtp_configured:
            raise MailError("SMTP ist nicht konfiguriert (MAIL_SMTP_HOST/MAIL_FROM in .env).")
        if not to or "@" not in to:
            raise MailError("Keine gültige Empfängeradresse.")
        msg = EmailMessage()
        msg["From"] = self.s.mail_from
        msg["To"] = to
        msg["Subject"] = subject
        msg_id = make_msgid(domain=self.s.mail_from.split("@")[-1] or "localhost")
        msg["Message-ID"] = msg_id
        if in_reply_to:
            msg["In-Reply-To"] = in_reply_to
            msg["References"] = in_reply_to
        msg.set_content(body)
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
