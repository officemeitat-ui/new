"""E-Mail-Dateien einlesen (.eml und Outlook-.msg) und auf Phishing prüfen.

* ``load_email`` liefert Betreff, Absender, Reply-To, Kopfzeilen, Text/HTML, Links und Anhänge – für
  Drag & Drop aus Outlook in Posteingang/Tickets und für das Kundenportal.
* ``analyze_phishing`` bewertet eine Mail nach nachvollziehbaren Regeln (SPF/DKIM/DMARC, Absender-Tricks,
  Link-Ziele, gefährliche Anhänge, Druck-/Passwort-Sprache) – Ergebnis mit Begründung und Empfehlung.
"""

from __future__ import annotations

import email
import html as html_mod
import re
from email import policy
from email.utils import getaddresses, parseaddr
from typing import Any
from urllib.parse import urlparse

MAX_ATTACHMENT = 20 * 1024 * 1024
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def _addr(value: str) -> tuple[str, str]:
    name, addr = parseaddr(value or "")
    return name.strip(), addr.strip().lower()


def load_email(data: bytes, filename: str = "") -> dict[str, Any]:
    if data[:8] == OLE_MAGIC or filename.lower().endswith(".msg"):
        try:
            return _load_msg(data)
        except ValueError:
            raise
        except Exception as exc:  # noqa: BLE001 - beschädigte Outlook-Datei
            raise ValueError("Die Outlook-Datei (.msg) ist beschädigt oder wird nicht unterstützt.") from exc
    return _load_eml(data)


def _load_eml(data: bytes) -> dict[str, Any]:
    msg = email.message_from_bytes(data, policy=policy.default)
    if not msg.keys():
        raise ValueError("Keine gültige E-Mail-Datei (.eml oder .msg).")
    text, markup, attachments = [], [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = part.get_content_type()
        filename = part.get_filename()
        disposition = part.get_content_disposition()
        if filename or disposition == "attachment" or ctype.startswith(("image/", "application/")):
            payload = part.get_payload(decode=True) or b""
            if payload and len(payload) <= MAX_ATTACHMENT:
                attachments.append((filename or f"anhang.{ctype.split('/')[-1]}", ctype, payload))
            continue
        try:
            content = part.get_content()
        except (LookupError, ValueError):
            content = (part.get_payload(decode=True) or b"").decode("utf-8", errors="replace")
        if ctype == "text/plain":
            text.append(str(content))
        elif ctype == "text/html":
            markup.append(str(content))
    name, addr = _addr(str(msg.get("From", "")))
    return {
        "subject": str(msg.get("Subject", "") or "").strip(), "from_name": name, "from_email": addr,
        "reply_to": _addr(str(msg.get("Reply-To", "")))[1], "return_path": _addr(str(msg.get("Return-Path", "")))[1],
        "to": ", ".join(a for _, a in getaddresses([str(msg.get("To", ""))])),
        "date": str(msg.get("Date", "") or ""), "message_id": str(msg.get("Message-ID", "") or "").strip(),
        "in_reply_to": str(msg.get("In-Reply-To", "") or "").strip(),
        "headers": [(k, str(v)) for k, v in msg.items()], "text": "\n".join(text), "html": "\n".join(markup),
        "attachments": attachments,
    }


def _load_msg(data: bytes) -> dict[str, Any]:
    """Outlook-.msg (OLE/CFB) mit olefile lesen – Eigenschaften __substg1.0_XXXXTTTT."""
    import io

    try:
        import olefile
    except ImportError as exc:  # pragma: no cover - in requirements.txt
        raise ValueError("Für .msg-Dateien fehlt das Paket olefile (pip install olefile).") from exc
    try:
        ole = olefile.OleFileIO(io.BytesIO(data))
    except OSError as exc:
        raise ValueError("Keine gültige Outlook-Datei (.msg).") from exc

    def prop(prefix: str, pid: str) -> str:
        for kind, enc in (("001F", "utf-16-le"), ("001E", "cp1252")):
            path = f"{prefix}__substg1.0_{pid}{kind}"
            if ole.exists(path):
                return ole.openstream(path).read().decode(enc, errors="replace").rstrip("\x00")
        return ""

    def binary(prefix: str, pid: str) -> bytes:
        path = f"{prefix}__substg1.0_{pid}0102"
        return ole.openstream(path).read() if ole.exists(path) else b""

    headers_raw = prop("", "007D")
    headers = list(email.message_from_string(headers_raw, policy=policy.default).items()) if headers_raw else []
    hdr = {k.lower(): str(v) for k, v in headers}
    html_body = prop("", "1013") or binary("", "1013").decode("utf-8", errors="replace")
    attachments = []
    for entry in ole.listdir(streams=False, storages=True):
        if len(entry) == 1 and entry[0].startswith("__attach_version1.0_#"):
            base = entry[0] + "/"
            payload = binary(base, "3701")
            if payload and len(payload) <= MAX_ATTACHMENT:
                name = prop(base, "3707") or prop(base, "3704") or "anhang"
                attachments.append((name, prop(base, "370E") or "application/octet-stream", payload))
    sender = prop("", "5D01") or prop("", "0C1F") or prop("", "0065")
    out = {
        "subject": prop("", "0037").strip(), "from_name": prop("", "0C1A") or prop("", "0042"),
        "from_email": sender.strip().lower() if "@" in sender else _addr(hdr.get("from", ""))[1],
        "reply_to": _addr(hdr.get("reply-to", ""))[1], "return_path": _addr(hdr.get("return-path", ""))[1],
        "to": prop("", "0E04"), "date": hdr.get("date", ""), "message_id": hdr.get("message-id", "") or prop("", "1035"),
        "in_reply_to": hdr.get("in-reply-to", "") or prop("", "1042"), "headers": headers,
        "text": prop("", "1000"), "html": html_body, "attachments": attachments,
    }
    ole.close()
    if not (out["subject"] or out["text"] or out["from_email"]):
        raise ValueError("Die Outlook-Datei enthält keine lesbare Nachricht.")
    return out


def body_text(mail: dict[str, Any]) -> str:
    from .mail import html_to_text

    return (mail.get("text") or "").strip() or html_to_text(mail.get("html") or "")


# ----------------------------------------------------------------------------- Phishing-Prüfung
SHORTENERS = {"bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at",
              "rb.gy", "t.ly", "s.id", "tiny.cc"}
RISKY_TLDS = (".zip", ".mov", ".top", ".xyz", ".click", ".country", ".gq", ".tk", ".ml", ".cf", ".work", ".support",
              ".rest", ".cam", ".icu", ".monster")
RISKY_EXT = (".exe", ".scr", ".js", ".jse", ".vbs", ".vbe", ".bat", ".cmd", ".ps1", ".msi", ".iso", ".img", ".hta",
             ".lnk", ".html", ".htm", ".svg", ".one", ".docm", ".xlsm", ".pptm", ".jar", ".com", ".pif", ".reg", ".wsf")
BRANDS = {"microsoft": ("microsoft.com", "office.com", "office365.com", "outlook.com", "live.com", "sharepoint.com"),
          "office 365": ("microsoft.com", "office.com"), "paypal": ("paypal.com", "paypal.at", "paypal.de"),
          "dhl": ("dhl.com", "dhl.at", "dhl.de"), "post": ("post.at",), "a1": ("a1.net", "a1.at"),
          "finanzonline": ("bmf.gv.at",), "finanzamt": ("bmf.gv.at",), "amazon": ("amazon.com", "amazon.de", "amazon.at"),
          "george": ("sparkasse.at", "erstebank.at", "george.at"), "raiffeisen": ("raiffeisen.at",),
          "bank austria": ("bankaustria.at",), "docusign": ("docusign.net", "docusign.com"), "dropbox": ("dropbox.com",),
          "apple": ("apple.com", "icloud.com"), "netflix": ("netflix.com",)}
PRESSURE = ("konto gesperrt", "konto wird gesperrt", "sofort", "innerhalb von 24 stunden", "letzte warnung", "dringend",
            "verify your account", "bestätigen sie ihr konto", "passwort läuft ab", "password expires", "ungewöhnliche anmeldung",
            "unusual sign-in", "zahlung fehlgeschlagen", "mahnung", "offene rechnung", "geschenkkarte", "gift card",
            "überweisung heute", "vertraulich", "bin gerade in einer besprechung", "zugangsdaten", "anmeldedaten",
            "postfach ist voll", "mailbox is full", "sendung konnte nicht zugestellt", "zollgebühr")
LINK_RE = re.compile(r"<a\s[^>]*href\s*=\s*[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
URL_RE = re.compile(r"https?://[^\s<>\"')]+", re.I)


def _domain(addr_or_url: str) -> str:
    v = addr_or_url.strip().lower()
    if "@" in v and "://" not in v:
        return v.rsplit("@", 1)[1].strip("> ")
    host = urlparse(v if "://" in v else f"http://{v}").hostname or ""
    return host[4:] if host.startswith("www.") else host


def _base(domain: str) -> str:
    parts = domain.split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "or", "gv", "ac") and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def analyze_phishing(mail: dict[str, Any]) -> dict[str, Any]:
    reasons: list[tuple[int, str]] = []

    def add(points: int, text: str) -> None:
        reasons.append((points, text))

    hdr = {}
    for k, v in mail.get("headers") or []:
        hdr.setdefault(k.lower(), []).append(str(v))
    auth = " ".join(hdr.get("authentication-results", []) + hdr.get("arc-authentication-results", [])).lower()
    for check in ("spf", "dkim", "dmarc"):
        m = re.search(rf"\b{check}=(\w+)", auth)
        if m and m.group(1) in ("fail", "softfail", "permerror"):
            add(35 if check == "dmarc" else 25, f"{check.upper()}-Prüfung fehlgeschlagen ({m.group(1)}) – Absender ist vermutlich gefälscht")
    from_domain = _domain(mail.get("from_email") or "")
    display = (mail.get("from_name") or "").lower()
    if re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", display) and from_domain and from_domain not in display:
        add(25, f"Anzeigename enthält eine andere Adresse („{mail.get('from_name')}“) als den echten Absender ({mail.get('from_email')})")
    reply_domain = _domain(mail.get("reply_to") or "")
    if reply_domain and from_domain and _base(reply_domain) != _base(from_domain):
        add(20, f"Antworten gehen an eine andere Domain ({mail.get('reply_to')})")
    text = body_text(mail)
    haystack = f"{mail.get('subject', '')} {display} {text}".lower()
    for brand, domains in BRANDS.items():
        if re.search(rf"\b{re.escape(brand)}\b", f"{display} {mail.get('subject', '').lower()}") and from_domain and \
                not any(from_domain == d or from_domain.endswith("." + d) for d in domains):
            add(25, f"Gibt sich als „{brand.title()}“ aus, kommt aber von {from_domain}")
            break
    links = []
    for href, label in LINK_RE.findall(mail.get("html") or ""):
        label_text = html_mod.unescape(re.sub(r"<[^>]+>", "", label)).strip()
        links.append((href.strip(), label_text))
    for url in URL_RE.findall(text):
        if not any(url == h for h, _ in links):
            links.append((url, ""))
    link_report = []
    flagged_links = 0
    for href, label in links[:50]:
        if not href.lower().startswith(("http://", "https://")):
            continue
        d = _domain(href)
        issue = ""
        if re.fullmatch(r"[\d.]+", d or ""):
            issue = "Link auf eine IP-Adresse"
        elif d in SHORTENERS:
            issue = "verkürzter Link (Ziel versteckt)"
        elif d.startswith("xn--") or ".xn--" in d:
            issue = "internationalisierte Domain (mögliche Doppelgänger-Schreibweise)"
        elif d.endswith(RISKY_TLDS):
            issue = f"Domain-Endung {d[d.rfind('.'):]} wird häufig für Betrug genutzt"
        elif label and URL_RE.match(label.strip()) and _base(_domain(label)) != _base(d):
            issue = f"Linktext zeigt {_domain(label)}, führt aber zu {d}"
        elif re.search(r"(login|signin|verify|account|passwort|password|secure|update)", href, re.I) and from_domain and \
                _base(d) != _base(from_domain):
            issue = "Anmelde-/Bestätigungslink auf fremder Domain"
        if issue:
            flagged_links += 1
        link_report.append({"url": href[:300], "domain": d, "issue": issue})
    if flagged_links:
        add(min(40, 15 * flagged_links), f"{flagged_links} verdächtige(r) Link(s)")
    risky = [n for n, _, _ in mail.get("attachments") or [] if n.lower().endswith(RISKY_EXT)]
    if risky:
        add(40, f"Gefährlicher Anhang: {', '.join(risky[:3])}")
    zips = [n for n, _, _ in mail.get("attachments") or [] if n.lower().endswith((".zip", ".rar", ".7z"))]
    if zips:
        add(15, f"Archiv im Anhang ({', '.join(zips[:2])}) – kann Schadsoftware verstecken")
    pressure = [p for p in PRESSURE if p in haystack]
    if pressure:
        add(min(25, 8 * len(pressure)), f"Druck/Köder-Formulierungen: „{'“, „'.join(pressure[:3])}“")
    if re.search(r"(passwort|password|kennwort|pin|tan)\b", haystack) and links:
        add(10, "Fordert Zugangsdaten an und enthält Links")
    score = min(100, sum(p for p, _ in reasons))
    verdict = "gefährlich" if score >= 60 else "verdächtig" if score >= 30 else "unauffällig"
    advice = {
        "gefährlich": "Nicht klicken, keine Anhänge öffnen, nicht antworten. Mail löschen – ME-IT ist informiert und prüft, "
                      "ob weitere Postfächer betroffen sind. Falls Sie bereits geklickt oder Daten eingegeben haben: sofort anrufen.",
        "verdächtig": "Vorsicht: Links nicht anklicken und keine Daten eingeben. Absender über einen bekannten Weg (Telefon) prüfen.",
        "unauffällig": "Keine typischen Phishing-Merkmale gefunden. Im Zweifel trotzdem nicht auf Links klicken und uns fragen.",
    }[verdict]
    return {"score": score, "verdict": verdict, "reasons": [t for _, t in sorted(reasons, key=lambda r: -r[0])],
            "links": link_report[:20], "advice": advice, "from": mail.get("from_email", ""),
            "subject": mail.get("subject", ""), "attachments": [n for n, _, _ in mail.get("attachments") or []]}


def phishing_markdown(result: dict[str, Any]) -> str:
    lines = [f"**Ergebnis: {result['verdict'].upper()}** (Risikowert {result['score']}/100)", "",
             f"- Absender: {result['from'] or '–'}", f"- Betreff: {result['subject'] or '–'}"]
    if result["attachments"]:
        lines.append(f"- Anhänge: {', '.join(result['attachments'])}")
    if result["reasons"]:
        lines += ["", "**Auffälligkeiten:**"] + [f"- {r}" for r in result["reasons"]]
    bad = [l for l in result["links"] if l["issue"]]
    if bad:
        lines += ["", "**Verdächtige Links (nicht anklicken):**"] + [f"- {l['domain']}: {l['issue']}" for l in bad[:10]]
    lines += ["", f"**Empfehlung:** {result['advice']}"]
    return "\n".join(lines)


# ----------------------------------------------------------------------------- KI-Zweitmeinung
AI_SYSTEM = (
    "Du bist IT-Sicherheitsanalyst bei einem österreichischen IT-Dienstleister. Beurteile, ob die E-Mail Phishing, "
    "Betrug (z. B. CEO-Fraud, geänderte Bankverbindung, gefälschte Rechnung) oder Schadsoftware-Versand ist. "
    "Die Ergebnisse der automatischen Regelprüfung sind beigefügt – bestätige oder widerlege sie mit eigenen Argumenten "
    "(Inhalt, Tonfall, Plausibilität, Absender-Domain vs. angebliche Firma). Links werden nicht geöffnet. "
    'Antworte NUR mit JSON: {"einschaetzung": "phishing" | "verdaechtig" | "legitim", "sicherheit": 0-100, '
    '"begruendung": ["kurzer Punkt", "…"], "empfehlung": "ein bis zwei Sätze für den Empfänger"}'
)
AI_VERDICTS = {"phishing": "Phishing", "verdaechtig": "verdächtig", "verdächtig": "verdächtig", "legitim": "legitim"}


def ai_opinion(llm: Any, mail: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    """Zweitmeinung der KI (lokal oder Claude – je nach Einstellung „Phishing-Prüfung“). Ergänzt die Regeln, ersetzt sie nicht.

    Die Absender-Domain wird bewusst getrennt genannt: Bei aktivierter Pseudonymisierung werden E-Mail-Adressen
    für Claude maskiert, die Domain ist aber das wichtigste Merkmal einer Fälschung.
    """
    auth = next((v for k, v in mail.get("headers") or [] if k.lower() == "authentication-results"), "")
    links = ", ".join(f"{link['domain']}{' (' + link['issue'] + ')' if link['issue'] else ''}" for link in result["links"][:15])
    prompt = "\n".join([
        f"Angezeigter Absendername: {mail.get('from_name') or '–'}",
        f"Absender-Domain: {_domain(mail.get('from_email', '')) or '–'}",
        f"Antwort-an-Domain: {_domain(mail.get('reply_to', '')) or '–'}",
        f"Betreff: {mail.get('subject') or '–'}",
        f"Authentifizierung (SPF/DKIM/DMARC): {auth[:400] or 'keine Angabe'}",
        f"Anhänge: {', '.join(n for n, _, _ in mail.get('attachments') or []) or 'keine'}",
        f"Link-Ziele: {links or 'keine'}",
        f"Regelprüfung: {result['verdict']} ({result['score']}/100) – {'; '.join(result['reasons']) or 'keine Auffälligkeiten'}",
        "", "Text der E-Mail (gekürzt):", body_text(mail)[:3500],
    ])
    data = llm.chat_json([{"role": "user", "content": prompt}], system=AI_SYSTEM)
    if not isinstance(data, dict):
        raise ValueError("Unerwartete Antwort der KI")
    raw = str(data.get("einschaetzung", "")).strip().lower()
    try:
        confidence = max(0, min(100, int(float(data.get("sicherheit", 50)))))
    except (TypeError, ValueError):
        confidence = 50
    reasons = [str(r).strip() for r in (data.get("begruendung") or []) if str(r).strip()][:6] \
        if isinstance(data.get("begruendung"), list) else [str(data.get("begruendung", "")).strip()][:1]
    return {"verdict": AI_VERDICTS.get(raw, "verdächtig"), "confidence": confidence, "reasons": [r for r in reasons if r],
            "advice": str(data.get("empfehlung", "")).strip()[:600],
            "provider": f"{getattr(llm, 'provider', '')} · {getattr(llm, 'model', '')}".strip(" ·")}
