"""Domain- & E-Mail-Sicherheitscheck je Kunde: Kann man im Namen des Kunden Mails fälschen? Läuft das Zertifikat ab?

Geprüft (nur öffentliche DNS-Einträge und das Website-Zertifikat – nichts wird verändert):
* **MX** und Mail-Anbieter (Microsoft 365, Google, andere)
* **SPF** – vorhanden, eindeutig, Abschluss (-all/~all/?all/+all), max. 10 DNS-Abfragen, Microsoft-Eintrag
* **DMARC** – vorhanden, Richtlinie (none/quarantine/reject), Berichte (rua), pct
* **DKIM** – Microsoft 365 (selector1/selector2), Google (google), sonst gängige Selektoren
* **MTA-STS / TLS-RPT** (Transportverschlüsselung erzwingen)
* Domains **ohne Mailbetrieb** – müssen trotzdem gegen Fälschung abgesichert sein (SPF -all, DMARC reject)
* **Website-Zertifikat** – gültig, passt zum Namen, Ablaufdatum

Ergebnis: Punktzahl 0–100, Befunde mit Empfehlung → Ticket, Chance im Radar, Zeile im Monatsbericht.
"""

from __future__ import annotations

import json
import re
import socket
import ssl
import threading
import time
from datetime import date, datetime
from typing import Any, Callable, Optional

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso

SEVERITY = {"kritisch": 0, "hoch": 1, "mittel": 2, "niedrig": 3, "info": 4}
WEIGHT = {"kritisch": 40, "hoch": 20, "mittel": 10, "niedrig": 3, "info": 0}
DOMAIN_RE = re.compile(r"^(?=.{4,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$")
FREEMAIL = {"gmail.com", "gmx.at", "gmx.net", "gmx.de", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "aon.at",
            "chello.at", "a1.net", "icloud.com", "web.de", "t-online.de", "me.com", "posteo.de", "proton.me", "protonmail.com"}
OTHER_SELECTORS = ("default", "dkim", "mail", "k1", "s1", "s2", "selector1", "selector2", "smtp", "mx", "key1")


class DnsError(RuntimeError):
    pass


class DnsResolver:
    """System-DNS über dnspython (Zeitlimit je Abfrage)."""

    def __init__(self, timeout: float = 5.0):
        import dns.resolver

        self._r = dns.resolver.Resolver()
        self._r.lifetime = timeout

    def _q(self, name: str, rtype: str):
        import dns.exception
        import dns.resolver

        try:
            return list(self._r.resolve(name, rtype))
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.resolver.NoNameservers):
            return []
        except dns.exception.DNSException as exc:
            raise DnsError(f"DNS-Abfrage {rtype} {name} fehlgeschlagen: {exc}") from exc

    def txt(self, name: str) -> list[str]:
        return [b"".join(r.strings).decode("utf-8", "replace") for r in self._q(name, "TXT")]

    def mx(self, name: str) -> list[tuple[int, str]]:
        return sorted((r.preference, str(r.exchange).rstrip(".").lower()) for r in self._q(name, "MX"))

    def cname(self, name: str) -> str:
        r = self._q(name, "CNAME")
        return str(r[0].target).rstrip(".").lower() if r else ""


def fetch_cert(host: str, port: int = 443, timeout: float = 6.0) -> dict[str, Any]:
    """Zertifikat der Website lesen – auch wenn es ungültig ist (dann mit Grund)."""
    def der_of(ctx: ssl.SSLContext) -> bytes:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as s:
                return s.getpeercert(binary_form=True)

    verified, error = True, ""
    try:
        der = der_of(ssl.create_default_context())
    except ssl.SSLCertVerificationError as exc:
        verified, error = False, exc.verify_message or str(exc)
        loose = ssl.create_default_context()
        loose.check_hostname, loose.verify_mode = False, ssl.CERT_NONE
        try:
            der = der_of(loose)
        except (OSError, ssl.SSLError) as exc2:
            return {"reachable": False, "error": str(exc2)}
    except (OSError, ssl.SSLError) as exc:
        return {"reachable": False, "error": str(exc)}
    from cryptography import x509

    cert = x509.load_der_x509_certificate(der)
    try:
        names = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName)
    except x509.ExtensionNotFound:
        names = []
    issuer = next((a.value for a in cert.issuer if a.oid == x509.NameOID.ORGANIZATION_NAME), "") or \
        next((a.value for a in cert.issuer if a.oid == x509.NameOID.COMMON_NAME), "")
    return {"reachable": True, "verified": verified, "error": error, "not_after": cert.not_valid_after_utc.date().isoformat(),
            "issuer": str(issuer), "names": [str(n) for n in names][:20]}


# ----------------------------------------------------------------------------- Prüfungen
def parse_tags(record: str) -> dict[str, str]:
    out = {}
    for part in record.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip().lower()] = v.strip()
    return out


def spf_lookups(resolver: Any, record: str, depth: int = 0, seen: set[str] | None = None) -> int:
    """DNS-Abfragen eines SPF-Eintrags inkl. Unter-Einträge (RFC 7208: max. 10)."""
    seen = seen if seen is not None else set()
    count = 0
    for term in record.split()[1:]:
        t = term.lstrip("+-~?").lower()
        if t.startswith(("include:", "redirect=")):
            count += 1
            target = t.split(":", 1)[1] if t.startswith("include:") else t.split("=", 1)[1]
            if target in seen or depth >= 9:
                continue
            seen.add(target)
            try:
                sub = next((r for r in resolver.txt(target) if r.lower().startswith("v=spf1")), "")
            except DnsError:
                sub = ""
            if sub:
                count += spf_lookups(resolver, sub, depth + 1, seen)
        elif t in ("a", "mx", "ptr") or t.startswith(("a:", "mx:", "ptr:", "exists:", "a/", "mx/")):
            count += 1
    return count


def provider_of(mx: list[tuple[int, str]]) -> str:
    hosts = " ".join(h for _, h in mx)
    if "mail.protection.outlook.com" in hosts:
        return "Microsoft 365"
    if "google.com" in hosts or "googlemail.com" in hosts:
        return "Google Workspace"
    if not mx:
        return ""
    return ".".join(mx[0][1].split(".")[-2:])


def check_domain(domain: str, resolver: Any, cert_fetch: Callable[[str], dict[str, Any]] | None = None,
                 today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    domain = domain.strip().lower().rstrip(".")
    findings: list[dict[str, Any]] = []

    def add(key: str, severity: str, title: str, detail: str, action: str) -> None:
        findings.append({"key": key, "severity": severity, "title": title, "detail": detail, "action": action})

    mx = resolver.mx(domain)
    null_mx = len(mx) == 1 and mx[0][1] in ("", ".")
    provider = provider_of(mx) if not null_mx else ""
    mail = bool(mx) and not null_mx
    spf_records = [r for r in resolver.txt(domain) if r.lower().startswith("v=spf1")]
    dmarc_records = [r for r in resolver.txt(f"_dmarc.{domain}") if r.lower().startswith("v=dmarc1")]
    spf = {"record": spf_records[0] if spf_records else "", "count": len(spf_records)}
    dmarc = {"record": dmarc_records[0] if dmarc_records else "", **(parse_tags(dmarc_records[0]) if dmarc_records else {})}

    # --- SPF ---------------------------------------------------------------------------------------
    if not spf_records:
        add("spf-missing", "hoch", "Kein SPF-Eintrag",
            "Ohne SPF kann jeder Server Mails mit dieser Absenderdomain verschicken.",
            "SPF-Eintrag anlegen" + (" (v=spf1 include:spf.protection.outlook.com -all)" if provider == "Microsoft 365" else
                                     " (v=spf1 -all bei Domains ohne Mailversand)" if not mail else ""))
    elif len(spf_records) > 1:
        add("spf-multiple", "hoch", f"{len(spf_records)} SPF-Einträge",
            "Mehrere SPF-Einträge machen SPF ungültig (permerror) – Mails können abgelehnt werden.", "Zu einem Eintrag zusammenführen.")
    else:
        rec = spf_records[0].lower()
        ending = next((t for t in rec.split() if t.endswith("all") and t.lstrip("+-~?") == "all"), "")
        spf["all"] = ending or "fehlt"
        if ending in ("+all", "all"):
            add("spf-pass-all", "kritisch", "SPF erlaubt allen Servern den Versand (+all)",
                "Der Eintrag erlaubt ausdrücklich jedem, im Namen der Domain zu senden.", "Auf „-all“ (bzw. „~all“) ändern.")
        elif ending == "?all" or not ending:
            add("spf-neutral", "mittel", "SPF ohne klare Ablehnung (?all bzw. kein all)",
                "Fremde Server werden nicht abgewiesen.", "Mit „-all“ oder „~all“ abschließen.")
        n = spf_lookups(resolver, spf_records[0])
        spf["lookups"] = n
        if n > 10:
            add("spf-lookups", "hoch", f"SPF benötigt {n} DNS-Abfragen (max. 10)",
                "Über 10 Abfragen ist SPF ungültig (permerror) – Mails können im Spam landen oder abgelehnt werden.",
                "Includes reduzieren bzw. IP-Bereiche direkt eintragen.")
        if provider == "Microsoft 365" and "spf.protection.outlook.com" not in rec:
            add("spf-m365", "mittel", "SPF ohne Microsoft-365-Eintrag",
                "Die Domain nutzt Microsoft 365, SPF erlaubt aber die Microsoft-Server nicht.", "include:spf.protection.outlook.com ergänzen.")

    # --- DMARC -------------------------------------------------------------------------------------
    policy = (dmarc.get("p") or "").lower()
    dmarc["policy"] = policy or ("fehlt" if not dmarc_records else "ungültig")
    if not dmarc_records:
        add("dmarc-missing", "hoch", "Kein DMARC",
            "Empfänger erfahren nicht, wie sie mit gefälschten Mails dieser Domain umgehen sollen – Phishing im Namen "
            "des Kunden (z. B. gefälschte Rechnungen an seine Kunden) wird zugestellt.",
            "DMARC mit Berichten einführen: zuerst p=none mit rua, nach 2–4 Wochen p=quarantine, dann p=reject.")
    elif policy == "none":
        add("dmarc-none", "mittel", "DMARC nur im Beobachtungsmodus (p=none)",
            "Gefälschte Mails werden weiterhin zugestellt.", "Berichte auswerten und auf p=quarantine bzw. p=reject anheben.")
    elif policy not in ("quarantine", "reject"):
        add("dmarc-invalid", "hoch", "DMARC-Eintrag ungültig", f"Unbekannte Richtlinie „{dmarc.get('p', '')}“.", "Eintrag korrigieren.")
    if dmarc_records and not dmarc.get("rua"):
        add("dmarc-rua", "niedrig", "DMARC ohne Berichte (rua)",
            "Ohne Berichte sieht niemand, wer im Namen der Domain sendet.", "rua=mailto:… ergänzen (z. B. Postfach oder DMARC-Dienst).")
    if dmarc_records and dmarc.get("pct") and dmarc["pct"] != "100":
        add("dmarc-pct", "niedrig", f"DMARC gilt nur für {dmarc['pct']} % der Mails", "Teilweise Anwendung.", "pct=100 setzen.")

    # --- DKIM --------------------------------------------------------------------------------------
    dkim: dict[str, Any] = {"selectors": []}
    if mail:
        if provider == "Microsoft 365":
            for sel in ("selector1", "selector2"):
                if resolver.cname(f"{sel}._domainkey.{domain}") or any("p=" in r for r in resolver.txt(f"{sel}._domainkey.{domain}")):
                    dkim["selectors"].append(sel)
            if not dkim["selectors"]:
                add("dkim-missing", "mittel", "DKIM für Microsoft 365 nicht eingerichtet",
                    "Mails werden nicht mit der eigenen Domain signiert – schlechtere Zustellung, DMARC greift nur über SPF.",
                    "Im Defender-Portal DKIM für die Domain aktivieren und die zwei CNAME-Einträge (selector1/selector2) anlegen.")
        elif provider == "Google Workspace":
            if any("p=" in r for r in resolver.txt(f"google._domainkey.{domain}")):
                dkim["selectors"].append("google")
            else:
                add("dkim-missing", "mittel", "DKIM für Google Workspace nicht eingerichtet",
                    "Mails werden nicht mit der eigenen Domain signiert.", "In der Google-Admin-Konsole DKIM generieren und eintragen.")
        else:
            for sel in OTHER_SELECTORS:
                if any("p=" in r for r in resolver.txt(f"{sel}._domainkey.{domain}")) or resolver.cname(f"{sel}._domainkey.{domain}"):
                    dkim["selectors"].append(sel)
                    break
            if not dkim["selectors"]:
                add("dkim-unknown", "info", "DKIM nicht prüfbar",
                    "Kein DKIM unter gängigen Selektoren gefunden – der Anbieter verwendet ggf. einen eigenen.",
                    "Beim Mail-Anbieter prüfen, ob DKIM aktiv ist.")
    else:
        if not spf_records or "-all" not in (spf_records[0].lower() if spf_records else "") or policy != "reject":
            add("nomail-protect", "hoch", "Domain ohne Mailbetrieb ist nicht gegen Fälschung geschützt",
                "Auch Domains ohne Postfächer werden für Phishing missbraucht.",
                "„v=spf1 -all“ und „v=DMARC1; p=reject“ eintragen (optional Null-MX).")

    # --- MTA-STS / TLS-RPT -------------------------------------------------------------------------
    sts = any(r.lower().startswith("v=stsv1") for r in resolver.txt(f"_mta-sts.{domain}")) if mail else False
    tlsrpt = any(r.lower().startswith("v=tlsrptv1") for r in resolver.txt(f"_smtp._tls.{domain}")) if mail else False
    if mail and not sts:
        add("mta-sts", "niedrig", "Keine MTA-STS-Richtlinie",
            "Verschlüsselte Zustellung an diese Domain wird nicht erzwungen (Mitlesen auf dem Transportweg möglich).",
            "MTA-STS (und TLS-RPT für Berichte) einrichten – bei Microsoft 365 inzwischen einfach möglich.")

    # --- Website-Zertifikat ------------------------------------------------------------------------
    web: dict[str, Any] = {}
    if cert_fetch:
        for host in (domain, f"www.{domain}"):
            web = {"host": host, **cert_fetch(host)}
            if web.get("reachable"):
                break
        if web.get("reachable"):
            days = (date.fromisoformat(web["not_after"]) - today).days
            web["days_left"] = days
            if days < 0:
                add("cert-expired", "kritisch", f"Website-Zertifikat abgelaufen ({web['host']})",
                    f"Abgelaufen am {web['not_after']} – Besucher sehen eine Sicherheitswarnung.", "Zertifikat sofort erneuern.")
            elif days <= 14:
                add("cert-expiring", "hoch", f"Website-Zertifikat läuft in {days} Tagen ab ({web['host']})",
                    f"Gültig bis {web['not_after']}.", "Erneuern bzw. automatische Verlängerung prüfen.")
            elif days <= 30:
                add("cert-expiring", "mittel", f"Website-Zertifikat läuft in {days} Tagen ab ({web['host']})",
                    f"Gültig bis {web['not_after']}.", "Erneuerung einplanen bzw. Automatik prüfen.")
            if not web.get("verified") and days >= 0:
                add("cert-invalid", "hoch", f"Website-Zertifikat ungültig ({web['host']})",
                    f"Browser melden: {web.get('error') or 'nicht vertrauenswürdig'}.", "Passendes Zertifikat (Name/Kette) einspielen.")

    if not mail:  # ohne Mailbetrieb zählt nur der Fälschungsschutz (eigener Befund oben)
        findings = [f for f in findings if f["key"] not in ("spf-missing", "spf-neutral", "dmarc-missing", "dmarc-none", "dmarc-rua",
                                                             "dmarc-pct")]
    score = max(0, 100 - sum(WEIGHT[f["severity"]] for f in findings))
    findings.sort(key=lambda f: SEVERITY[f["severity"]])
    return {"domain": domain, "checked_at": now_iso(), "mail": mail, "provider": provider, "mx": [h for _, h in mx][:5],
            "spf": spf, "dmarc": dmarc, "dkim": dkim, "mta_sts": sts, "tls_rpt": tlsrpt, "web": web,
            "score": score, "findings": findings}


# ----------------------------------------------------------------------------- Dienst
class DomainService:
    def __init__(self, db: Database):
        self.db = db
        self.resolver_factory: Callable[[], Any] = DnsResolver
        self.cert_fetch: Callable[[str], dict[str, Any]] | None = fetch_cert

    def rows(self, customer_id: int | None = None) -> list[dict[str, Any]]:
        sql = "SELECT d.*, c.name AS customer FROM domain_checks d LEFT JOIN customers c ON c.id = d.customer_id"
        params: list[Any] = []
        if customer_id:
            sql += " WHERE d.customer_id = ?"
            params.append(customer_id)
        out = []
        for r in self.db.query(sql + " ORDER BY COALESCE(d.score, 101), c.name, d.domain", params):
            out.append(self._view(r))
        return out

    def _view(self, r: dict[str, Any]) -> dict[str, Any]:
        res = loads(r["result"], {}) or {}
        ignored = set(loads(r["ignored"], []) or [])
        tickets = loads(r["tickets"], {}) or {}
        findings = [{**f, "ignored": f["key"] in ignored, "ticket_id": tickets.get(f["key"])} for f in res.get("findings", [])]
        open_ = [f for f in findings if not f["ignored"] and f["severity"] != "info"]
        return {"id": r["id"], "customer_id": r["customer_id"], "customer": r.get("customer"), "domain": r["domain"],
                "source": r["source"], "last_check": r["last_check"], "score": r["score"], "result": res, "findings": findings,
                "counts": {s: len([f for f in open_ if f["severity"] == s]) for s in ("kritisch", "hoch", "mittel", "niedrig")},
                "top": open_[0]["title"] if open_ else ""}

    def get(self, did: int) -> dict[str, Any] | None:
        r = self.db.query_one("SELECT d.*, c.name AS customer FROM domain_checks d LEFT JOIN customers c ON c.id = d.customer_id "
                              "WHERE d.id = ?", (did,))
        return self._view(r) if r else None

    def add(self, customer_id: int | None, domain: str, source: str = "manuell") -> int | None:
        domain = (domain or "").strip().lower().rstrip(".")
        domain = re.sub(r"^(https?://)?(www\.)?", "", domain).split("/")[0]
        if not DOMAIN_RE.match(domain) or domain in FREEMAIL or domain.endswith(".onmicrosoft.com"):
            return None
        existing = self.db.query_one("SELECT id FROM domain_checks WHERE domain = ?", (domain,))
        if existing:
            return existing["id"]
        return self.db.insert("domain_checks", {"customer_id": customer_id, "domain": domain, "source": source})

    def discover(self) -> int:
        before = self.db.scalar("SELECT COUNT(*) FROM domain_checks") or 0
        for c in self.db.query("SELECT id, email FROM customers"):
            if "@" in (c["email"] or ""):
                self.add(c["id"], c["email"].split("@")[-1], "kunde")
        for t in self.db.query("SELECT customer_id, snapshot FROM m365_tenants WHERE snapshot != ''"):
            for d in (loads(t["snapshot"], {}) or {}).get("domains", []):
                self.add(t["customer_id"], d, "microsoft 365")
        for s in self.db.query("SELECT customer_id, name FROM subscriptions WHERE kind IN ('domain', 'zertifikat')"):
            for d in re.findall(r"\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b", (s["name"] or "").lower()):
                self.add(s["customer_id"], d, "lizenzen")
        return (self.db.scalar("SELECT COUNT(*) FROM domain_checks") or 0) - before

    def check(self, did: int, today: date | None = None) -> dict[str, Any]:
        r = self.db.query_one("SELECT * FROM domain_checks WHERE id = ?", (did,))
        if not r:
            raise LookupError("Domain nicht gefunden")
        res = check_domain(r["domain"], self.resolver_factory(), self.cert_fetch, today)
        self.db.update("domain_checks", did, {"last_check": now_iso(), "score": res["score"],
                                              "result": json.dumps(res, ensure_ascii=False)})
        return self.get(did)

    def check_all(self) -> dict[str, Any]:
        done, errors = 0, []
        for r in self.db.query("SELECT id, domain FROM domain_checks"):
            try:
                self.check(r["id"])
                done += 1
            except (DnsError, LookupError) as exc:
                errors.append(f"{r['domain']}: {exc}")
        self.db.set_setting("domains_last_check", {"at": now_iso(), "done": done, "errors": errors})
        return {"done": done, "errors": errors}

    def _set(self, did: int, field: str, value: Any) -> None:
        self.db.update("domain_checks", did, {field: json.dumps(value, ensure_ascii=False)})

    def ignore(self, did: int, key: str, ignore: bool) -> None:
        r = self.db.query_one("SELECT ignored FROM domain_checks WHERE id = ?", (did,))
        keys = set(loads(r["ignored"], []) or [])
        self._set(did, "ignored", sorted(keys | {key} if ignore else keys - {key}))

    def ticket_for(self, did: int, key: str) -> int:
        d = self.get(did)
        f = next((x for x in (d or {}).get("findings", []) if x["key"] == key), None)
        if not d or not f:
            raise LookupError("Befund nicht gefunden")
        if f["ticket_id"] and self.db.get("tickets", f["ticket_id"]):
            return f["ticket_id"]
        prio = {"kritisch": "kritisch", "hoch": "hoch", "mittel": "normal"}.get(f["severity"], "niedrig")
        tid = self.db.insert("tickets", {"customer_id": d["customer_id"], "title": f"{d['domain']}: {f['title']}"[:200],
                                         "description": f"{f['detail']}\n\nEmpfohlen: {f['action']}", "status": "neu",
                                         "priority": prio, "category": "Sicherheit" if not f["key"].startswith("cert") else "Netzwerk"})
        tickets = loads(self.db.query_one("SELECT tickets FROM domain_checks WHERE id = ?", (did,))["tickets"], {}) or {}
        tickets[key] = tid
        self._set(did, "tickets", tickets)
        return tid

    def opportunities(self, customer_id: int, today: date | None = None) -> list[dict[str, Any]]:
        rows = self.rows(customer_id)
        mail_keys = {"spf-missing", "spf-multiple", "spf-pass-all", "spf-neutral", "spf-lookups", "spf-m365", "dmarc-missing",
                     "dmarc-none", "dmarc-invalid", "dkim-missing", "nomail-protect"}
        weak = [r for r in rows if any(f["key"] in mail_keys and not f["ignored"] for f in r["findings"])]
        out = []
        if weak:
            names = ", ".join(r["domain"] for r in weak[:4])
            out.append({"kind": "security", "title": f"E-Mail-Absicherung (SPF/DKIM/DMARC): {names}",
                        "reason": "Absenderdomain kann gefälscht werden bzw. Zustellung leidet – Schutz vor Rechnungsbetrug im "
                                  "Namen des Kunden.", "code": "STD", "hours": max(2.0, 1.5 * len(weak)),
                        "priority": 3 if any(f["key"] in ("dmarc-missing", "spf-pass-all", "nomail-protect") and not f["ignored"]
                                             for r in weak for f in r["findings"]) else 2})
        expiring = [r for r in rows if any(f["key"] in ("cert-expired", "cert-expiring", "cert-invalid") and not f["ignored"]
                                           for f in r["findings"])]
        if expiring:
            out.append({"kind": "vertrag", "title": f"Website-Zertifikat erneuern: {', '.join(r['domain'] for r in expiring[:3])}",
                        "reason": "Zertifikat abgelaufen, ungültig oder läuft in Kürze ab.", "code": "STD", "hours": 1.0,
                        "priority": 3})
        return out


def report_lines(db: Database, customer_id: int) -> tuple[list[str], dict[str, Any]]:
    rows = DomainService(db).rows(customer_id)
    rows = [r for r in rows if r["last_check"]]
    if not rows:
        return [], {}
    parts = []
    for r in rows[:3]:
        pol = (r["result"].get("dmarc") or {}).get("policy", "")
        label = {"reject": "geschützt (DMARC reject)", "quarantine": "geschützt (DMARC quarantine)", "none": "nur Beobachtung (DMARC none)",
                 "fehlt": "**nicht gegen Fälschung geschützt** (kein DMARC)"}.get(pol, pol)
        parts.append(f"{r['domain']} {label}")
    return ["- E-Mail-Absicherung: " + "; ".join(parts)], {"domains": [{"domain": r["domain"], "score": r["score"]} for r in rows]}


class DomainIn(BaseModel):
    customer_id: Optional[int] = None
    domain: str = Field(..., min_length=4, max_length=253)


class IgnoreIn(BaseModel):
    ignore: bool = True


def register(app: FastAPI, ctx: Any, admin_only, start: bool = False) -> DomainService:
    db: Database = ctx.db
    svc = DomainService(db)
    app.state.domains = svc

    def need(did: int) -> dict[str, Any]:
        d = svc.get(did)
        if not d:
            raise HTTPException(404, "Domain nicht gefunden")
        return d

    def run_check(did: int) -> dict[str, Any]:
        try:
            return svc.check(did)
        except DnsError as exc:
            raise HTTPException(502, str(exc))

    @app.get("/api/domains")
    def list_domains(customer_id: Optional[int] = None) -> dict:
        rows = svc.rows(customer_id)
        return {"domains": rows, "last": db.get_setting("domains_last_check", None)}

    @app.post("/api/domains", status_code=201)
    def add(data: DomainIn) -> dict:
        if data.customer_id and not db.get("customers", data.customer_id):
            raise HTTPException(422, "Kunde nicht gefunden")
        did = svc.add(data.customer_id, data.domain)
        if not did:
            raise HTTPException(422, "Bitte eine gültige eigene Domain angeben (z. B. kunde.at, keine Freemail-Domain)")
        return run_check(did)

    @app.get("/api/domains/{did}")
    def get(did: int) -> dict:
        return need(did)

    @app.delete("/api/domains/{did}")
    def delete(did: int) -> dict:
        need(did)
        db.delete("domain_checks", did)
        return {"ok": True}

    @app.post("/api/domains/{did}/check")
    def check(did: int) -> dict:
        need(did)
        return run_check(did)

    @app.post("/api/domains/discover")
    def discover() -> dict:
        return {"added": svc.discover()}

    @app.post("/api/domains/check-all", dependencies=[Depends(admin_only)])
    def check_all() -> dict:
        return svc.check_all()

    @app.post("/api/domains/{did}/findings/{key}/ticket", status_code=201)
    def ticket(did: int, key: str) -> dict:
        need(did)
        try:
            return {"ticket_id": svc.ticket_for(did, key)}
        except LookupError as exc:
            raise HTTPException(404, str(exc))

    @app.post("/api/domains/{did}/findings/{key}/ignore")
    def ignore(did: int, key: str, data: IgnoreIn) -> dict:
        need(did)
        svc.ignore(did, key, data.ignore)
        return {"ok": True}

    if start:
        def loop() -> None:
            time.sleep(600)
            while True:
                last = (db.get_setting("domains_last_check", {}) or {}).get("at", "")
                if not last or (datetime.now() - datetime.fromisoformat(last[:19])).days >= 7:
                    try:
                        svc.discover()
                        svc.check_all()
                    except Exception:  # noqa: BLE001
                        pass
                time.sleep(6 * 3600)

        threading.Thread(target=loop, name="domain-check", daemon=True).start()
    return svc
