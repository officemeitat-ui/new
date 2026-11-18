"""Microsoft 365 der Kunden: Benutzer, Lizenzen, MFA, Admin-Konten, verdächtige Weiterleitungen, Secure Score.

Funktionsweise
* **Eine** mandantenfähige App-Registrierung bei ME-IT (nur Leserechte). Der Kunde (bzw. sein globaler Admin)
  erteilt über einen Zustimmungs-Link einmalig die Freigabe für seinen Tenant – kein Passwort, kein GDAP nötig.
* Danach liest das Cockpit regelmäßig (Standard: täglich) den Tenant und leitet daraus **Befunde** ab:
  Konten ohne MFA (Admins besonders), fehlende MFA-Pflicht, externe Weiterleitungen (typisches Zeichen für ein
  gekapertes Postfach → sofort Ticket), ungenutzte oder gesperrte Konten mit Lizenz, zu viele globale Admins,
  niedriger Secure Score, inaktive Gäste.
* **Lizenzabgleich mit der Rechnung**: zugewiesene Lizenzen je Produkt gegen die verrechnete Anzahl unter
  „Lizenzen & Verträge“ – zu wenig verrechnet, zu viel verrechnet, gekauft aber nicht zugewiesen, nicht erfasst.

Benötigte Anwendungsberechtigungen (Microsoft Graph, Admin-Zustimmung):
Directory.Read.All, AuditLog.Read.All, Reports.Read.All, UserAuthenticationMethod.Read.All,
MailboxSettings.Read, SecurityEvents.Read.All, Policy.Read.All. Fehlende Rechte führen nur zu Hinweisen.
"""

from __future__ import annotations

import json
import re
import secrets
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional
from urllib.parse import urlencode

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso

GRAPH = "https://graph.microsoft.com/v1.0"
SEVERITY = {"kritisch": 0, "hoch": 1, "mittel": 2, "niedrig": 3}
INACTIVE_DAYS = 90
GUEST_INACTIVE_DAYS = 180
MAX_DETAIL_USERS = 300  # Einzelabfragen (MFA-Methoden, Posteingangsregeln) je Tenant

SKU_NAMES = {
    "O365_BUSINESS_ESSENTIALS": "Microsoft 365 Business Basic",
    "O365_BUSINESS_PREMIUM": "Microsoft 365 Business Standard",
    "SPB": "Microsoft 365 Business Premium",
    "O365_BUSINESS": "Microsoft 365 Apps for business",
    "SMB_BUSINESS": "Microsoft 365 Apps for business",
    "OFFICESUBSCRIPTION": "Microsoft 365 Apps for enterprise",
    "EXCHANGESTANDARD": "Exchange Online (Plan 1)",
    "EXCHANGEENTERPRISE": "Exchange Online (Plan 2)",
    "EXCHANGEDESKLESS": "Exchange Online Kiosk",
    "EXCHANGEARCHIVE_ADDON": "Exchange Online Archiving",
    "STANDARDPACK": "Office 365 E1",
    "ENTERPRISEPACK": "Office 365 E3",
    "ENTERPRISEPREMIUM": "Office 365 E5",
    "DESKLESSPACK": "Office 365 F3",
    "SPE_E3": "Microsoft 365 E3",
    "SPE_E5": "Microsoft 365 E5",
    "SPE_F1": "Microsoft 365 F3",
    "TEAMS_ESSENTIALS_AAD": "Teams Essentials",
    "Microsoft_Teams_Premium": "Teams Premium",
    "MCOEV": "Teams Phone Standard",
    "AAD_PREMIUM": "Microsoft Entra ID P1",
    "AAD_PREMIUM_P2": "Microsoft Entra ID P2",
    "EMS": "Enterprise Mobility + Security E3",
    "INTUNE_A": "Microsoft Intune Plan 1",
    "ATP_ENTERPRISE": "Defender for Office 365 (Plan 1)",
    "DEFENDER_ENDPOINT_P1": "Defender for Endpoint P1",
    "Microsoft_365_Copilot": "Microsoft 365 Copilot",
    "VISIOCLIENT": "Visio Plan 2",
    "PROJECTPROFESSIONAL": "Project Plan 3",
    "POWER_BI_PRO": "Power BI Pro",
}
FREE_SKUS = {"FLOW_FREE", "POWER_BI_STANDARD", "TEAMS_EXPLORATORY", "WINDOWS_STORE", "STREAM", "CCIBOTS_PRIVPREV_VIRAL",
             "POWERAPPS_VIRAL", "POWERAPPS_DEV", "MICROSOFT_BUSINESS_CENTER", "RIGHTSMANAGEMENT_ADHOC",
             "Microsoft_Teams_Exploratory_Dept", "PROJECT_MADEIRA_PREVIEW_IW_SKU", "FORMS_PRO", "POWER_BI_PRO_TRIAL",
             "MCOMEETADV", "Power_Pages_vTrial_for_Makers", "POWERAUTOMATE_ATTENDED_RPA_TRIAL"}
MFA_METHODS = {"microsoftAuthenticatorAuthenticationMethod": "Authenticator-App", "phoneAuthenticationMethod": "Telefon/SMS",
               "fido2AuthenticationMethod": "Sicherheitsschlüssel (FIDO2)", "softwareOathAuthenticationMethod": "TOTP-App",
               "windowsHelloForBusinessAuthenticationMethod": "Windows Hello", "platformCredentialAuthenticationMethod": "Plattform-Schlüssel",
               "temporaryAccessPassAuthenticationMethod": "Temporärer Zugangspass", "x509CertificateAuthenticationMethod": "Zertifikat",
               "passkeyAuthenticationMethod": "Passkey"}
SENSITIVE_WORDS = ("rechnung", "invoice", "zahlung", "payment", "bank", "iban", "überweisung", "passwort", "password",
                   "security", "sicherheit", "phish", "hack", "konto", "mfa")


class GraphError(RuntimeError):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


# ----------------------------------------------------------------------------- Graph-Zugriff je Tenant
class TenantClient:
    """Client-Credentials gegen den Tenant des Kunden (mandantenfähige App)."""

    def __init__(self, client_id: str, client_secret: str, tenant: str):
        from .msauth import TokenSource

        self.client_id, self.client_secret, self.tenant = client_id, client_secret, tenant
        self.auth = TokenSource(tenant, client_id, client_secret)

    def _auth(self) -> dict[str, str]:
        from .msauth import MsAuthError

        try:
            return self.auth.headers()
        except MsAuthError as exc:
            text = str(exc)
            if "Zustimmung" in text or "nicht gefunden" in text:
                raise GraphError("Die Zustimmung des Kunden fehlt noch (Zustimmungs-Link öffnen lassen). " + text, 401) from exc
            raise GraphError(text, 401 if "AADSTS" in text or "Geheimnis" in text else 0) from exc

    def get(self, path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
        import httpx

        if path.startswith("https://") and not path.startswith(GRAPH + "/"):
            raise GraphError("Unerwartete Weiterleitungs-Adresse von Microsoft Graph")  # Token nie an fremde Hosts
        url = path if path.startswith("https://") else GRAPH + path
        for attempt in range(3):
            try:
                resp = httpx.get(url, params=params, headers={**self._auth(), "ConsistencyLevel": "eventual"}, timeout=30)
            except httpx.HTTPError as exc:
                raise GraphError(f"Microsoft Graph nicht erreichbar: {exc}") from exc
            if resp.status_code == 429 and attempt < 2:
                time.sleep(min(10, int(resp.headers.get("Retry-After", "2") or 2)))
                continue
            if resp.status_code >= 400:
                try:
                    detail = resp.json().get("error", {}).get("message", "")
                except ValueError:
                    detail = ""
                raise GraphError(f"Graph {resp.status_code}: {detail or path}", resp.status_code)
            return resp.json()
        raise GraphError("Graph: zu viele Anfragen", 429)

    def get_all(self, path: str, params: dict[str, str] | None = None, limit: int = 5000) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        data = self.get(path, params)
        while True:
            out += data.get("value", [])
            nxt = data.get("@odata.nextLink")
            if not nxt or len(out) >= limit:
                return out[:limit]
            data = self.get(nxt)


# ----------------------------------------------------------------------------- Hilfsfunktionen
def sku_name(part: str) -> str:
    return SKU_NAMES.get(part) or part.replace("_", " ").title()


def is_free(sku: dict[str, Any]) -> bool:
    return sku.get("part") in FREE_SKUS or int(sku.get("enabled") or 0) >= 10000


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def match_subscription(part: str, subs: list[dict[str, Any]], sku_map: dict[str, Any]) -> dict[str, Any] | None:
    """Welche Zeile unter „Lizenzen & Verträge“ gehört zu diesem Microsoft-Produkt?"""
    if str(sku_map.get(part) or "") and str(sku_map.get(part)) != "0":
        return next((s for s in subs if str(s["id"]) == str(sku_map[part])), None)
    full = _norm(sku_name(part))
    core = re.sub(r"^(microsoft 365|office 365|microsoft) ", "", full)
    for s in subs:
        name = _norm(s.get("name", ""))
        if full in name or (len(core) > 4 and core in name) or _norm(part) == name:
            return s
    return None


def _when(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def analyze_rule(rule: dict[str, Any], own_domains: set[str]) -> list[str]:
    """Posteingangsregel prüfen: externe Weiterleitung oder „verstecken + löschen“ (typisch nach Konto-Übernahme)."""
    if rule.get("isEnabled") is False:
        return []
    actions = rule.get("actions") or {}
    reasons = []
    targets = []
    for key in ("forwardTo", "redirectTo", "forwardAsAttachmentTo"):
        for r in actions.get(key) or []:
            addr = ((r or {}).get("emailAddress") or {}).get("address", "").lower()
            if addr and addr.rsplit("@", 1)[-1] not in own_domains:
                targets.append(addr)
    if targets:
        reasons.append(f"leitet extern weiter an {', '.join(sorted(set(targets)))}")
    conditions = json.dumps(rule.get("conditions") or {}, ensure_ascii=False).lower()
    hides = actions.get("delete") or actions.get("permanentDelete") or (actions.get("moveToFolder") and actions.get("markAsRead"))
    name = (rule.get("displayName") or "").strip()
    if hides and (any(w in conditions for w in SENSITIVE_WORDS) or len(re.sub(r"[\W_]", "", name)) <= 2):
        reasons.append(f"versteckt/löscht Mails (Regel „{name or '–'}“)")
    return reasons


# ----------------------------------------------------------------------------- Abruf eines Tenants
def collect(client: Any, own_domains_hint: set[str] | None = None) -> dict[str, Any]:
    """Liest den Tenant. Fehlende Berechtigungen/Lizenzen (z. B. Anmeldedaten ohne Entra ID P1) → Hinweise statt Abbruch."""
    warnings: list[str] = []

    def soft(label: str, fn: Callable[[], Any], default: Any = None) -> Any:
        try:
            return fn()
        except GraphError as exc:
            warnings.append(f"{label}: {exc}")
            return default

    org = (client.get_all("/organization") or [{}])[0]
    domains = {d.get("name", "").lower() for d in org.get("verifiedDomains") or [] if d.get("name")} | (own_domains_hint or set())
    default_domain = next((d.get("name") for d in org.get("verifiedDomains") or [] if d.get("isDefault")), "")
    skus = [{"id": s.get("skuId"), "part": s.get("skuPartNumber", ""), "name": sku_name(s.get("skuPartNumber", "")),
             "enabled": int((s.get("prepaidUnits") or {}).get("enabled") or 0), "consumed": int(s.get("consumedUnits") or 0),
             "status": s.get("capabilityStatus", "")}
            for s in soft("Lizenzen", lambda: client.get_all("/subscribedSkus"), [])]
    by_sku = {s["id"]: s for s in skus}

    fields = "id,displayName,userPrincipalName,mail,accountEnabled,userType,assignedLicenses,createdDateTime,department,jobTitle"
    sign_in = True
    try:
        users = client.get_all("/users", {"$select": fields + ",signInActivity", "$top": "999"})
    except GraphError as exc:
        sign_in = False
        warnings.append("Letzte Anmeldung nicht lesbar (Entra ID P1 bzw. AuditLog.Read.All nötig) – "
                        "ungenutzte Konten werden daher nicht erkannt." if exc.status in (400, 403) else f"Benutzer: {exc}")
        users = client.get_all("/users", {"$select": fields, "$top": "999"})

    roles: dict[str, list[str]] = {}
    for role in soft("Admin-Rollen", lambda: client.get_all("/directoryRoles", {"$expand": "members($select=id)"}), []):
        for m in role.get("members") or []:
            roles.setdefault(m.get("id"), []).append(role.get("displayName", ""))

    mfa: dict[str, tuple[bool, list[str]]] = {}
    reg = soft("MFA-Bericht", lambda: client.get_all("/reports/authenticationMethods/userRegistrationDetails"), None)
    if reg is not None:
        for r in reg:
            mfa[r.get("id")] = (bool(r.get("isMfaRegistered")), list(r.get("methodsRegistered") or []))
    else:  # ohne Premium-Bericht: Methoden je Benutzer
        warnings.pop()  # Bericht nicht verfügbar ist kein Fehler – Einzelabfrage folgt
        for u in [u for u in users if u.get("accountEnabled") and u.get("userType") != "Guest"][:MAX_DETAIL_USERS]:
            try:
                methods = client.get_all(f"/users/{u['id']}/authentication/methods")
            except GraphError as exc:
                warnings.append(f"MFA-Methoden nicht lesbar (UserAuthenticationMethod.Read.All): {exc}")
                break
            kinds = [m.get("@odata.type", "").rsplit(".", 1)[-1] for m in methods]
            strong = [MFA_METHODS[k] for k in kinds if k in MFA_METHODS]
            mfa[u["id"]] = (bool(strong), strong)

    rules: dict[str, list[str]] = {}
    mailbox_users = [u for u in users if u.get("accountEnabled") and u.get("userType") != "Guest" and u.get("assignedLicenses")]
    for u in mailbox_users[:MAX_DETAIL_USERS]:
        try:
            found = client.get_all(f"/users/{u['id']}/mailFolders/inbox/messageRules")
        except GraphError as exc:
            if exc.status == 403:
                warnings.append("Posteingangsregeln nicht lesbar (MailboxSettings.Read fehlt).")
                break
            continue  # z. B. kein Postfach
        hits = [r for rule in found for r in analyze_rule(rule, domains)]
        if hits:
            rules[u["id"]] = hits

    sec_defaults = soft("Sicherheitsstandards", lambda: client.get("/policies/identitySecurityDefaultsEnforcementPolicy"), None)
    policies = soft("Bedingter Zugriff", lambda: client.get_all("/identity/conditionalAccess/policies"), None)
    ca_mfa = None if policies is None else sum(
        1 for p in policies if p.get("state") == "enabled"
        and "mfa" in [c.lower() for c in ((p.get("grantControls") or {}).get("builtInControls") or [])])
    score = soft("Secure Score", lambda: client.get_all("/security/secureScores", {"$top": "1"}), [])
    score = score[0] if score else None

    out_users = []
    for u in users:
        uid = u["id"]
        last = ((u.get("signInActivity") or {}).get("lastSignInDateTime") or "") if sign_in else ""
        reg_mfa = mfa.get(uid)
        out_users.append({
            "object_id": uid, "upn": u.get("userPrincipalName", ""), "display_name": u.get("displayName", ""),
            "enabled": bool(u.get("accountEnabled")), "user_type": u.get("userType") or "Member",
            "licenses": [{"sku": by_sku[l["skuId"]]["part"], "name": by_sku[l["skuId"]]["name"]}
                         for l in u.get("assignedLicenses") or [] if l.get("skuId") in by_sku],
            "last_sign_in": last, "mfa": None if reg_mfa is None else reg_mfa[0],
            "mfa_methods": reg_mfa[1] if reg_mfa else [], "admin_roles": roles.get(uid, []), "rules": rules.get(uid, []),
            "department": u.get("department") or "", "job_title": u.get("jobTitle") or "",
            "created_dt": u.get("createdDateTime") or ""})
    return {
        "tenant_name": org.get("displayName", ""), "tenant_id": org.get("id", ""), "domain": default_domain,
        "domains": sorted(domains), "skus": skus, "users": out_users, "sign_in_data": sign_in,
        "security_defaults": None if sec_defaults is None else bool(sec_defaults.get("isEnabled")),
        "ca_mfa_policies": ca_mfa,
        "secure_score": {"current": round(float(score.get("currentScore") or 0), 1), "max": round(float(score.get("maxScore") or 0), 1)}
        if score else None,
        "warnings": warnings,
    }


# ----------------------------------------------------------------------------- Befunde
def findings(tenant: dict[str, Any], users: list[dict[str, Any]], subs: list[dict[str, Any]],
             today: date | None = None) -> list[dict[str, Any]]:
    today = today or date.today()
    now = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc)
    snap = loads(tenant.get("snapshot"), {}) or {}
    sku_map = loads(tenant.get("sku_map"), {}) or {}
    ignored = set(loads(tenant.get("ignored"), []) or [])
    tickets = loads(tenant.get("tickets"), {}) or {}
    out: list[dict[str, Any]] = []

    def add(key: str, severity: str, title: str, detail: str, action: str, names: list[str] | None = None, **extra: Any) -> None:
        out.append({"key": key, "severity": severity, "title": title, "detail": detail, "action": action,
                    "users": (names or [])[:50], "ignored": key in ignored, "ticket_id": tickets.get(key), **extra})

    def price_of(part: str) -> float | None:
        s = match_subscription(part, subs, sku_map)
        return float(s["unit_price"]) / (12 if s.get("billing_cycle") == "jahr" else 1) if s and s.get("unit_price") else None

    def label(u: dict[str, Any]) -> str:
        return u["display_name"] or u["upn"]

    members = [u for u in users if u["user_type"] != "Guest"]
    active = [u for u in members if u["enabled"]]

    # --- Externe Weiterleitungen / versteckende Regeln (mögliche Konto-Übernahme) ---------------------
    for u in active:
        for reason in loads(u["rules"], []) if isinstance(u["rules"], str) else u["rules"]:
            if "extern" in reason:
                add(f"forward:{u['object_id']}", "kritisch", f"Externe Weiterleitung: {label(u)}",
                    f"Posteingangsregel {reason}. Typisches Zeichen für ein übernommenes Postfach (Rechnungsbetrug).",
                    "Sofort mit dem Benutzer klären, Regel löschen, Passwort zurücksetzen, Sitzungen abmelden, Anmeldungen prüfen.",
                    [u["upn"]], auto_ticket=True)
            else:
                add(f"rule:{u['object_id']}", "hoch", f"Verdächtige Posteingangsregel: {label(u)}", f"Regel {reason}.",
                    "Mit dem Benutzer klären; wenn unbekannt: wie Konto-Übernahme behandeln.", [u["upn"]])

    # --- MFA -------------------------------------------------------------------------------------------
    def mfa_of(u: dict[str, Any]) -> Any:
        return u["mfa"]

    admins = [u for u in active if (loads(u["admin_roles"], []) if isinstance(u["admin_roles"], str) else u["admin_roles"])]
    admin_no_mfa = [u for u in admins if mfa_of(u) in (0, False)]
    if admin_no_mfa:
        add("mfa-admin", "kritisch", f"{len(admin_no_mfa)} Admin-Konto/Konten ohne MFA",
            "Ein Administrator ohne zweiten Faktor ist der häufigste Einstieg für Angreifer in Microsoft 365.",
            "MFA (Authenticator oder FIDO2-Schlüssel) für alle Admins sofort einrichten.", [label(u) for u in admin_no_mfa])
    no_mfa = [u for u in active if mfa_of(u) in (0, False) and u not in admin_no_mfa]
    if no_mfa:
        add("mfa-users", "hoch" if len(no_mfa) * 5 >= max(1, len(active)) else "mittel",
            f"{len(no_mfa)} von {len(active)} Benutzern ohne MFA",
            "Ohne zweiten Faktor reicht ein gestohlenes Passwort (Phishing) für den Zugriff auf Mails und Dateien.",
            "MFA-Einführung mit Authenticator-App planen (inkl. Kurzanleitung für die Mitarbeiter).", [label(u) for u in no_mfa])
    if snap.get("security_defaults") is False and snap.get("ca_mfa_policies") == 0:
        add("mfa-policy", "hoch", "Keine MFA-Pflicht im Tenant",
            "Weder Sicherheitsstandards noch eine Richtlinie für bedingten Zugriff erzwingen MFA – registrierte MFA wird "
            "nicht zwingend verlangt.",
            "Sicherheitsstandards aktivieren oder (ab Business Premium) Richtlinie „MFA für alle Benutzer“ anlegen.")

    # --- Admin-Konten ---------------------------------------------------------------------------------
    globals_ = [u for u in admins if "Global Administrator" in (u["admin_roles"] if isinstance(u["admin_roles"], list)
                                                               else loads(u["admin_roles"], []))]
    if len(globals_) > 4:
        add("admins-many", "mittel", f"{len(globals_)} globale Administratoren",
            "Microsoft empfiehlt höchstens 4 globale Admins – jedes weitere Konto vergrößert die Angriffsfläche.",
            "Rechte auf Rollen mit weniger Befugnissen reduzieren (z. B. Benutzeradministrator).", [label(u) for u in globals_])
    elif len(globals_) == 1:
        add("admins-one", "niedrig", "Nur ein globaler Administrator",
            "Fällt dieses Konto aus (MFA-Gerät verloren, Sperre), ist der Tenant nicht mehr verwaltbar.",
            "Zweites Notfall-Admin-Konto mit FIDO2-Schlüssel anlegen und sicher verwahren (Keeper).", [label(u) for u in globals_])
    daily_admins = [u for u in globals_ if any(l["sku"] not in FREE_SKUS for l in (u["licenses"] if isinstance(u["licenses"], list)
                                                                                  else loads(u["licenses"], [])))]
    if daily_admins and len(globals_) > 1:
        add("admins-daily", "niedrig", "Admin-Konten werden auch täglich genutzt",
            "Globale Admins mit Postfach-Lizenz lesen Mails mit Admin-Rechten – Phishing trifft dann direkt den Admin.",
            "Getrennte, unlizenzierte Admin-Konten (admin-…@) verwenden.", [label(u) for u in daily_admins])

    # --- Ungenutzte / gesperrte Konten mit Lizenz --------------------------------------------------------
    def lic(u: dict[str, Any]) -> list[dict[str, str]]:
        return [l for l in (u["licenses"] if isinstance(u["licenses"], list) else loads(u["licenses"], [])) if l["sku"] not in FREE_SKUS]

    def savings(us: list[dict[str, Any]]) -> float:
        return round(sum(price_of(l["sku"]) or 0 for u in us for l in lic(u)), 2)

    disabled = [u for u in members if not u["enabled"] and lic(u)]
    if disabled:
        add("licensed-disabled", "mittel", f"{len(disabled)} gesperrte Konten mit Lizenz",
            "Gesperrte Konten (z. B. ausgeschiedene Mitarbeiter) belegen weiter kostenpflichtige Lizenzen.",
            "Postfach ggf. in freigegebenes Postfach umwandeln, dann Lizenz entfernen und Anzahl reduzieren.",
            [label(u) for u in disabled], savings_month=savings(disabled))
    if snap.get("sign_in_data"):
        stale = []
        for u in active:
            if not lic(u):
                continue
            last, created = _when(u["last_sign_in"]), _when(u["created_dt"])
            if (last and (now - last).days > INACTIVE_DAYS) or (not last and created and (now - created).days > 30):
                stale.append(u)
        if stale:
            add("licensed-inactive", "mittel", f"{len(stale)} lizenzierte Konten seit über {INACTIVE_DAYS} Tagen ohne Anmeldung",
                "Vermutlich nicht mehr benötigt – kostet Lizenzen und ist ein unbeobachtetes Einfallstor.",
                "Mit dem Kunden klären: sperren bzw. Austritt durchführen, Lizenz freigeben.",
                [label(u) for u in stale], savings_month=savings(stale))
        guests = [u for u in users if u["user_type"] == "Guest" and u["enabled"]
                  and (_when(u["last_sign_in"]) is None or (now - _when(u["last_sign_in"])).days > GUEST_INACTIVE_DAYS)
                  and _when(u["created_dt"]) and (now - _when(u["created_dt"])).days > GUEST_INACTIVE_DAYS]
        if guests:
            add("guests-inactive", "niedrig", f"{len(guests)} inaktive Gastkonten",
                "Externe Gäste mit Zugriff auf Teams/SharePoint, die seit über einem halben Jahr nicht aktiv waren.",
                "Gäste entfernen oder Zugriffsüberprüfung einrichten.", [label(u) for u in guests])

    # --- Secure Score ------------------------------------------------------------------------------------
    score = snap.get("secure_score")
    if score and score.get("max"):
        pct = round(100 * score["current"] / score["max"])
        if pct < 60:
            add("secure-score", "hoch" if pct < 40 else "mittel", f"Microsoft Secure Score {pct} %",
                f"{score['current']} von {score['max']} Punkten. Branchenüblich für KMU mit Betreuung: 60 % und mehr.",
                "Empfehlungen im Defender-Portal abarbeiten (MFA, Mail-Schutz, Admin-Konten, Geräte).")

    # --- Lizenzabgleich mit der Rechnung -----------------------------------------------------------------
    for sku in snap.get("skus") or []:
        if is_free(sku) or (not sku["consumed"] and not sku["enabled"]):
            continue
        sub = match_subscription(sku["part"], subs, sku_map)
        base = {"sku": sku["part"], "sku_name": sku["name"], "assigned": sku["consumed"], "purchased": sku["enabled"],
                "subscription_id": sub["id"] if sub else None, "billed": int(sub["quantity"] or 0) if sub else None}
        unit = (float(sub["unit_price"] or 0) / (12 if sub.get("billing_cycle") == "jahr" else 1)) if sub else 0
        if not sub:
            if sku["consumed"]:
                add(f"lic-missing:{sku['part']}", "mittel", f"{sku['name']}: {sku['consumed']} im Einsatz, nicht unter Lizenzen erfasst",
                    "Diese Lizenzen tauchen weder in der Vertragsübersicht noch in der Rechnung auf.",
                    "Als Lizenz anlegen (Preis ergänzen) – dann läuft sie im Rechnungslauf mit.", license_action="create", **base)
            continue
        billed = int(sub["quantity"] or 0)
        if sku["consumed"] > billed and sub.get("billable"):
            add(f"lic-under:{sku['part']}", "hoch", f"{sku['name']}: {sku['consumed']} zugewiesen, {billed} verrechnet",
                f"{sku['consumed'] - billed} Lizenz(en) werden genutzt, aber nicht verrechnet.",
                "Anzahl übernehmen – ab dem nächsten Rechnungslauf korrekt.", license_action="quantity",
                gap_month=round((sku["consumed"] - billed) * unit, 2), **base)
        elif billed > sku["consumed"] and sub.get("billable"):
            add(f"lic-over:{sku['part']}", "mittel", f"{sku['name']}: {billed} verrechnet, nur {sku['consumed']} zugewiesen",
                "Der Kunde zahlt für Lizenzen, die niemand nutzt – fällt spätestens beim QBR auf.",
                "Anzahl übernehmen oder freie Lizenzen beim nächsten Eintritt verwenden.", license_action="quantity",
                savings_month=round((billed - sku["consumed"]) * unit, 2), **base)
        if sku["enabled"] > sku["consumed"]:
            add(f"lic-unassigned:{sku['part']}", "niedrig", f"{sku['name']}: {sku['enabled'] - sku['consumed']} gekauft, nicht zugewiesen",
                f"Bei Microsoft sind {sku['enabled']} Lizenzen gekauft, zugewiesen sind {sku['consumed']}.",
                "Beim nächsten Eintritt verwenden oder zur Verlängerung reduzieren.",
                savings_month=round((sku["enabled"] - sku["consumed"]) * float(sub.get("unit_cost") or 0)
                                    / (12 if sub.get("billing_cycle") == "jahr" else 1), 2), **base)

    out.sort(key=lambda f: (f["ignored"], SEVERITY[f["severity"]]))
    return out


# ----------------------------------------------------------------------------- Dienst
class M365Service:
    def __init__(self, db: Database, settings: Any):
        self.db, self.settings = db, settings
        self.factory: Callable[[str], Any] = self._client

    @property
    def client_id(self) -> str:
        return self.settings.m365_client_id or self.settings.graph_client_id

    @property
    def configured(self) -> bool:
        from .msauth import has_credential

        return bool(self.client_id and has_credential(self.settings.m365_client_secret or self.settings.graph_client_secret))

    def _client(self, tenant: str) -> TenantClient:
        return TenantClient(self.client_id, self.settings.m365_client_secret or self.settings.graph_client_secret, tenant)

    def tenant(self, cid: int) -> dict[str, Any] | None:
        return self.db.query_one("SELECT * FROM m365_tenants WHERE customer_id = ?", (cid,))

    def ensure(self, cid: int) -> dict[str, Any]:
        t = self.tenant(cid)
        if not t:
            self.db.insert("m365_tenants", {"customer_id": cid})
            t = self.tenant(cid)
        return t

    def users(self, cid: int) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT * FROM m365_users WHERE customer_id = ? ORDER BY enabled DESC, user_type DESC, display_name",
                             (cid,))
        for r in rows:
            for k in ("licenses", "mfa_methods", "admin_roles", "rules"):
                r[k] = loads(r[k], [])
            r["enabled"] = bool(r["enabled"])
        return rows

    def subs(self, cid: int) -> list[dict[str, Any]]:
        return self.db.query("SELECT * FROM subscriptions WHERE customer_id = ?", (cid,))

    def findings(self, cid: int, today: date | None = None) -> list[dict[str, Any]]:
        t = self.tenant(cid)
        if not t or not t["last_sync"]:
            return []
        return findings(t, self.users(cid), self.subs(cid), today)

    # -- Zustimmung
    def redirect_uri(self, base: str) -> str:
        return f"{(self.settings.public_url or base).rstrip('/')}/api/public/m365/consent"

    def consent_link(self, cid: int, base: str, tenant_hint: str = "") -> str:
        if not self.configured:
            raise ValueError("App-Registrierung fehlt (M365_CLIENT_ID/M365_CLIENT_SECRET bzw. GRAPH_* in .env).")
        t = self.ensure(cid)
        state = secrets.token_urlsafe(24)
        hint = (tenant_hint or t["tenant_id"] or t["domain"] or "").strip()
        self.db.update("m365_tenants", t["id"], {"consent_state": state, **({"domain": hint} if hint and "." in hint
                                                                             and not t["tenant_id"] else {})})
        return (f"https://login.microsoftonline.com/{hint or 'organizations'}/v2.0/adminconsent?"
                + urlencode({"client_id": self.client_id, "scope": "https://graph.microsoft.com/.default",
                             "redirect_uri": self.redirect_uri(base), "state": state}))

    def consent_callback(self, state: str, tenant: str, error: str = "", description: str = "") -> dict[str, Any] | None:
        if not state:
            return None
        t = self.db.query_one("SELECT * FROM m365_tenants WHERE consent_state = ? AND consent_state != ''", (state,))
        if not t:
            return None
        if error:
            self.db.update("m365_tenants", t["id"], {"status": "fehler", "consent_state": "",
                                                     "error": f"Zustimmung abgelehnt: {description or error}"[:500]})
        else:
            self.db.update("m365_tenants", t["id"], {"tenant_id": tenant or t["tenant_id"], "status": "verbunden",
                                                     "consented_at": now_iso(), "consent_state": "", "error": ""})
            from .team import log_activity

            log_activity(self.db, None, "m365_verbunden", "customer", t["customer_id"], "Microsoft 365: Zugriff erteilt")
        return self.db.get("m365_tenants", t["id"])

    # -- Abruf
    def sync(self, cid: int, today: date | None = None) -> dict[str, Any]:
        t = self.ensure(cid)
        target = t["tenant_id"] or t["domain"]
        if not target:
            raise ValueError("Tenant-ID oder Domain des Kunden fehlt.")
        try:
            data = collect(self.factory(target))
        except GraphError as exc:
            self.db.update("m365_tenants", t["id"], {"status": "ausstehend" if exc.status == 401 else "fehler",
                                                     "error": str(exc)[:500]})
            raise
        ts = now_iso()
        with self.db.connect() as conn:
            seen = []
            for u in data["users"]:
                seen.append(u["object_id"])
                row = {**u, "customer_id": cid, "synced_at": ts, "enabled": int(u["enabled"]),
                       "mfa": None if u["mfa"] is None else int(u["mfa"])}
                for k in ("licenses", "mfa_methods", "admin_roles", "rules"):
                    row[k] = json.dumps(row[k], ensure_ascii=False)
                cols = ["customer_id", "object_id", "upn", "display_name", "enabled", "user_type", "licenses", "last_sign_in",
                        "mfa", "mfa_methods", "admin_roles", "rules", "department", "job_title", "created_dt", "synced_at"]
                conn.execute(f"INSERT INTO m365_users ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)}) "
                             "ON CONFLICT(customer_id, object_id) DO UPDATE SET "
                             + ", ".join(f"{c} = excluded.{c}" for c in cols[2:]), [row[c] for c in cols])
            conn.execute(f"DELETE FROM m365_users WHERE customer_id = ? AND object_id NOT IN ({', '.join('?' for _ in seen) or "''"})",
                         [cid, *seen])
        snapshot = {k: data[k] for k in ("skus", "sign_in_data", "security_defaults", "ca_mfa_policies", "secure_score",
                                         "warnings", "domains")}
        history = loads(t["score_history"], []) or []
        if data["secure_score"] and data["secure_score"]["max"]:
            day = (today or date.today()).isoformat()
            pct = round(100 * data["secure_score"]["current"] / data["secure_score"]["max"], 1)
            history = [h for h in history if h[0] != day][-399:] + [[day, pct]]
        self.db.update("m365_tenants", t["id"], {
            "tenant_id": data["tenant_id"] or t["tenant_id"], "display_name": data["tenant_name"], "domain": data["domain"] or t["domain"],
            "status": "verbunden", "last_sync": ts, "error": "", "snapshot": json.dumps(snapshot, ensure_ascii=False),
            "score_history": json.dumps(history)})
        created = self._auto_tickets(cid, today)
        found = self.findings(cid, today)
        return {"users": len(data["users"]), "findings": len([f for f in found if not f["ignored"]]),
                "critical": len([f for f in found if f["severity"] == "kritisch" and not f["ignored"]]),
                "tickets_created": created, "warnings": data["warnings"]}

    def _auto_tickets(self, cid: int, today: date | None) -> int:
        created = 0
        for f in self.findings(cid, today):
            if f.get("auto_ticket") and not f["ignored"] and not f["ticket_id"]:
                self.ticket_for(cid, f["key"], today=today, priority="kritisch")
                created += 1
        return created

    def sync_all(self) -> dict[str, Any]:
        done, errors = 0, []
        for t in self.db.query("SELECT customer_id FROM m365_tenants WHERE status IN ('verbunden', 'fehler') "
                               "AND (tenant_id != '' OR domain != '')"):
            try:
                self.sync(t["customer_id"])
                done += 1
            except (GraphError, ValueError) as exc:
                errors.append(f"Kunde {t['customer_id']}: {exc}")
        self.db.set_setting("m365_last_sync_all", {"at": now_iso(), "done": done, "errors": errors})
        return {"done": done, "errors": errors}

    # -- Aktionen
    def _set_json(self, t: dict[str, Any], field: str, value: Any) -> None:
        self.db.update("m365_tenants", t["id"], {field: json.dumps(value, ensure_ascii=False)})

    def ticket_for(self, cid: int, key: str, today: date | None = None, priority: str | None = None) -> int:
        f = next((x for x in self.findings(cid, today) if x["key"] == key), None)
        if not f:
            raise ValueError("Befund nicht (mehr) vorhanden")
        if f["ticket_id"] and self.db.get("tickets", f["ticket_id"]):
            return f["ticket_id"]
        prio = priority or {"kritisch": "kritisch", "hoch": "hoch", "mittel": "normal"}.get(f["severity"], "niedrig")
        lines = [f["detail"], "", f"Empfohlen: {f['action']}"]
        if f["users"]:
            lines += ["", "Betroffen:"] + [f"- {u}" for u in f["users"]]
        tid = self.db.insert("tickets", {"customer_id": cid, "title": f"Microsoft 365: {f['title']}"[:200],
                                         "description": "\n".join(lines), "status": "neu", "priority": prio,
                                         "category": "Sicherheit" if f["key"].split(":")[0] in (
                                             "forward", "rule", "mfa-admin", "mfa-users", "mfa-policy", "admins-many",
                                             "admins-one", "admins-daily", "secure-score", "guests-inactive") else "E-Mail/M365"})
        t = self.tenant(cid)
        tickets = loads(t["tickets"], {}) or {}
        tickets[key] = tid
        self._set_json(t, "tickets", tickets)
        return tid

    def ignore(self, cid: int, key: str, ignore: bool) -> None:
        t = self.ensure(cid)
        keys = set(loads(t["ignored"], []) or [])
        keys = keys | {key} if ignore else keys - {key}
        self._set_json(t, "ignored", sorted(keys))

    def apply_license(self, cid: int, sku: str, subscription_id: int | None = None) -> dict[str, Any]:
        """Zugewiesene Anzahl in „Lizenzen & Verträge“ übernehmen bzw. Lizenz neu anlegen (läuft dann im Rechnungslauf)."""
        t = self.ensure(cid)
        snap = loads(t["snapshot"], {}) or {}
        s = next((x for x in snap.get("skus") or [] if x["part"] == sku), None)
        if not s:
            raise ValueError("Produkt im Tenant nicht gefunden")
        sku_map = loads(t["sku_map"], {}) or {}
        if subscription_id:
            if not self.db.query_one("SELECT id FROM subscriptions WHERE id = ? AND customer_id = ?", (subscription_id, cid)):
                raise ValueError("Lizenz gehört nicht zu diesem Kunden")
            sku_map[sku] = subscription_id
            self._set_json(t, "sku_map", sku_map)
        sub = match_subscription(sku, self.subs(cid), sku_map)
        from .team import log_activity

        if sub:
            before = sub["quantity"]
            self.db.update("subscriptions", sub["id"], {"quantity": s["consumed"]})
            log_activity(self.db, None, "lizenzabgleich", "customer", cid,
                         f"{sub['name']}: Anzahl {before:g} → {s['consumed']} (laut Microsoft 365)")
            return {**self.db.get("subscriptions", sub["id"]), "changed_from": before}
        sid = self.db.insert("subscriptions", {"customer_id": cid, "name": s["name"], "vendor": "Microsoft", "kind": "abo",
                                               "quantity": s["consumed"], "billing_cycle": "monat", "per_user": True,
                                               "billable": True, "auto_renew": True,
                                               "notes": f"aus Microsoft 365 übernommen ({sku}) – Preis ergänzen"})
        sku_map[sku] = sid
        self._set_json(self.tenant(cid), "sku_map", sku_map)
        log_activity(self.db, None, "lizenzabgleich", "customer", cid, f"{s['name']} ({s['consumed']}×) aus Microsoft 365 angelegt")
        return {**self.db.get("subscriptions", sid), "created": True}

    # -- Übersichten
    def summary(self, cid: int, today: date | None = None) -> dict[str, Any] | None:
        t = self.tenant(cid)
        if not t:
            return None
        users = self.users(cid) if t["last_sync"] else []
        active = [u for u in users if u["enabled"] and u["user_type"] != "Guest"]
        known = [u for u in active if u["mfa"] is not None]
        found = [f for f in findings(t, users, self.subs(cid), today) if not f["ignored"]] if t["last_sync"] else []
        snap = loads(t["snapshot"], {}) or {}
        score = snap.get("secure_score")
        return {
            "customer_id": cid, "status": t["status"], "tenant": t["display_name"] or t["domain"] or t["tenant_id"],
            "domain": t["domain"], "last_sync": t["last_sync"], "error": t["error"],
            "users": len(active), "guests": len([u for u in users if u["user_type"] == "Guest"]),
            "licensed": len([u for u in active if u["licenses"]]),
            "mfa_pct": round(100 * len([u for u in known if u["mfa"]]) / len(known)) if known else None,
            "secure_score_pct": round(100 * score["current"] / score["max"]) if score and score.get("max") else None,
            "score_history": loads(t["score_history"], []),
            "findings": {sev: len([f for f in found if f["severity"] == sev]) for sev in SEVERITY},
            "top": found[0]["title"] if found else "",
            "savings_month": round(sum(f.get("savings_month") or 0 for f in found), 2),
            "gap_month": round(sum(f.get("gap_month") or 0 for f in found), 2),
        }

    def overview(self) -> list[dict[str, Any]]:
        rows = []
        for t in self.db.query("SELECT t.customer_id, c.name FROM m365_tenants t JOIN customers c ON c.id = t.customer_id ORDER BY c.name"):
            s = self.summary(t["customer_id"])
            rows.append({**s, "customer": t["name"]})
        return rows

    def opportunities(self, cid: int, today: date | None = None) -> list[dict[str, Any]]:
        """Für das Umsatz-Radar: Nachverrechnung und Absicherung (Werte aus den eigenen Preisen)."""
        out = []
        for f in self.findings(cid, today):
            if f["ignored"]:
                continue
            if f["key"].startswith("lic-under:") and f.get("gap_month"):
                out.append({"kind": "vertrag", "title": f"Nachverrechnen: {f['sku_name']} (+{f['assigned'] - f['billed']})",
                            "reason": f"{f['assigned']} Lizenzen im Microsoft-365-Tenant zugewiesen, {f['billed']} verrechnet.",
                            "code": "STD", "monthly": f["gap_month"], "priority": 3})
        mfa = [f for f in self.findings(cid, today) if f["key"] in ("mfa-admin", "mfa-users", "mfa-policy", "secure-score")
               and not f["ignored"]]
        if mfa:
            affected = sum(len(f["users"]) for f in mfa if f["key"] in ("mfa-admin", "mfa-users"))
            out.append({"kind": "security", "title": "Microsoft 365 absichern (MFA, Admin-Konten, Richtlinien)",
                        "reason": "; ".join(f["title"] for f in mfa) + ".", "code": "STD",
                        "hours": round(2 + 0.25 * affected, 1), "priority": 3 if any(f["severity"] == "kritisch" for f in mfa) else 2})
        return out

    def portal_view(self, cid: int) -> dict[str, Any] | None:
        t = self.tenant(cid)
        if not t or not t["last_sync"]:
            return None
        users = [u for u in self.users(cid) if u["user_type"] != "Guest"]
        return {"last_sync": t["last_sync"], "users": [
            {"name": u["display_name"], "upn": u["upn"], "enabled": u["enabled"], "licenses": [l["name"] for l in u["licenses"]
                                                                                              if l["sku"] not in FREE_SKUS],
             "mfa": u["mfa"], "last_sign_in": u["last_sign_in"][:10]} for u in users]}


# ----------------------------------------------------------------------------- API
class TenantIn(BaseModel):
    tenant_id: Optional[str] = Field(None, max_length=120)


class IgnoreIn(BaseModel):
    ignore: bool = True


class LicenseIn(BaseModel):
    sku: str = Field(..., max_length=120)
    subscription_id: Optional[int] = None


CONSENT_PAGE = """<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Microsoft 365 – {company}</title><style>body{{font:16px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:#f4f6fa;color:#0f172a;margin:0;
display:grid;place-items:center;min-height:100vh;padding:16px}}.c{{background:#fff;border-radius:14px;border-top:4px solid #00bcd4;
padding:28px;max-width:520px;box-shadow:0 4px 24px rgba(0,0,0,.06)}}h1{{font-size:1.25rem;margin:0 0 .6rem}}</style></head>
<body><div class="c"><h1>{title}</h1><p>{text}</p><p style="color:#64748b;font-size:.9rem">{company}</p></div></body></html>"""


def register(app: FastAPI, db: Database, settings: Any, admin_only, start: bool = False) -> M365Service:
    svc = M365Service(db, settings)
    app.state.m365 = svc
    company = getattr(settings, "company_name", "ME-IT")

    def need(cid: int) -> dict[str, Any]:
        if not db.get("customers", cid):
            raise HTTPException(404, "Kunde nicht gefunden")
        t = svc.tenant(cid)
        if not t:
            raise HTTPException(404, "Microsoft 365 ist für diesen Kunden noch nicht eingerichtet")
        return t

    @app.get("/api/m365")
    def overview(request: Request) -> dict:
        return {"configured": svc.configured, "redirect_uri": svc.redirect_uri(str(request.base_url)),
                "tenants": svc.overview(), "last_sync_all": db.get_setting("m365_last_sync_all", None)}

    @app.get("/api/m365/{cid}")
    def detail(cid: int) -> dict:
        t = need(cid)
        snap = loads(t["snapshot"], {}) or {}
        subs = svc.subs(cid)
        sku_map = loads(t["sku_map"], {}) or {}
        skus = [{**s, "free": is_free(s), "subscription": (lambda m: {"id": m["id"], "name": m["name"], "quantity": m["quantity"]}
                                                           if m else None)(match_subscription(s["part"], subs, sku_map))}
                for s in snap.get("skus") or []]
        return {"tenant": {k: t[k] for k in ("tenant_id", "display_name", "domain", "status", "consented_at", "last_sync", "error")},
                "summary": svc.summary(cid), "snapshot": {**snap, "skus": skus}, "users": svc.users(cid),
                "findings": svc.findings(cid), "subscriptions": [{"id": s["id"], "name": s["name"]} for s in subs]}

    @app.put("/api/m365/{cid}")
    def set_tenant(cid: int, data: TenantIn) -> dict:
        if not db.get("customers", cid):
            raise HTTPException(404, "Kunde nicht gefunden")
        t = svc.ensure(cid)
        value = (data.tenant_id or "").strip().lower()
        if value and not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9.-]+\.[a-z]{2,}", value):
            raise HTTPException(422, "Bitte Tenant-ID (GUID) oder Domain (z. B. kunde.onmicrosoft.com) angeben")
        db.update("m365_tenants", t["id"], {"tenant_id": value if "-" in value and "." not in value else t["tenant_id"],
                                            "domain": value if "." in value else t["domain"]})
        return svc.tenant(cid)

    @app.post("/api/m365/{cid}/consent-link")
    def consent_link(cid: int, request: Request, data: TenantIn | None = None) -> dict:
        if not db.get("customers", cid):
            raise HTTPException(404, "Kunde nicht gefunden")
        try:
            url = svc.consent_link(cid, str(request.base_url), (data.tenant_id if data else "") or "")
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        return {"url": url, "redirect_uri": svc.redirect_uri(str(request.base_url))}

    @app.post("/api/m365/{cid}/sync")
    def sync(cid: int) -> dict:
        need(cid)
        if not svc.configured:
            raise HTTPException(409, "App-Registrierung fehlt (M365_CLIENT_ID/M365_CLIENT_SECRET in .env)")
        try:
            return svc.sync(cid)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        except GraphError as exc:
            raise HTTPException(502, str(exc))

    @app.post("/api/m365/sync-all", dependencies=[Depends(admin_only)])
    def sync_all() -> dict:
        return svc.sync_all()

    @app.post("/api/m365/{cid}/findings/{key}/ticket", status_code=201)
    def finding_ticket(cid: int, key: str) -> dict:
        need(cid)
        try:
            return {"ticket_id": svc.ticket_for(cid, key)}
        except ValueError as exc:
            raise HTTPException(404, str(exc))

    @app.post("/api/m365/{cid}/findings/{key}/ignore")
    def finding_ignore(cid: int, key: str, data: IgnoreIn) -> dict:
        need(cid)
        svc.ignore(cid, key, data.ignore)
        return {"ok": True}

    @app.post("/api/m365/{cid}/licenses")
    def apply_license(cid: int, data: LicenseIn) -> dict:
        need(cid)
        try:
            return svc.apply_license(cid, data.sku, data.subscription_id)
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.delete("/api/m365/{cid}", dependencies=[Depends(admin_only)])
    def disconnect(cid: int) -> dict:
        t = need(cid)
        db.query("DELETE FROM m365_users WHERE customer_id = ?", (cid,))
        db.delete("m365_tenants", t["id"])
        return {"ok": True, "hint": "Im Tenant des Kunden zusätzlich die Unternehmens-App entfernen (Entra ID → Unternehmensanwendungen)."}

    @app.get("/api/public/m365/consent", response_class=HTMLResponse, include_in_schema=False)
    def consent_return(state: str = "", tenant: str = "", admin_consent: str = "", error: str = "",
                       error_description: str = "") -> HTMLResponse:
        import html as _html

        t = svc.consent_callback(state, tenant, error, error_description)
        if not t:
            title, text = "Link ungültig oder bereits verwendet", "Bitte fordern Sie bei uns einen neuen Zustimmungs-Link an."
        elif error:
            title, text = "Zugriff nicht erteilt", f"Microsoft meldet: {_html.escape(error_description or error)[:300]}"
        else:
            title, text = "Danke – Zugriff erteilt", ("Wir können jetzt Sicherheit und Lizenzen Ihres Microsoft 365 überwachen "
                                                     "(nur lesend). Sie können dieses Fenster schließen.")
        return HTMLResponse(CONSENT_PAGE.format(company=_html.escape(company), title=title, text=text),
                            status_code=200 if t and not error else 400)

    if start and settings.m365_sync_hours > 0 and svc.configured:
        def loop() -> None:
            time.sleep(120)
            while True:
                if svc.configured:
                    try:
                        svc.sync_all()
                    except Exception:  # noqa: BLE001 - Hintergrund-Abruf darf nie abstürzen
                        pass
                time.sleep(settings.m365_sync_hours * 3600)

        threading.Thread(target=loop, name="m365-sync", daemon=True).start()
    return svc


def report_lines(db: Database, customer_id: int, since: str = "", until: str = "") -> tuple[list[str], dict[str, Any]]:
    """Kennzahlen für Monatsbericht und QBR: MFA-Abdeckung, Secure Score (mit Verlauf), Ein-/Austritte im Zeitraum."""
    lines: list[str] = []
    facts: dict[str, Any] = {}
    s = M365Service(db, None).summary(customer_id)
    if s and s["last_sync"]:
        hist = s["score_history"] or []
        before = next((p for d, p in reversed(hist) if since and d < since[:10]), None)
        score = s["secure_score_pct"]
        parts = []
        if s["mfa_pct"] is not None:
            parts.append(f"Zwei-Faktor-Anmeldung bei **{s['mfa_pct']} %** der Konten")
        if score is not None:
            parts.append(f"Microsoft Secure Score **{score} %**" + (f" (vorher {before:.0f} %)" if before is not None and round(before) != score else ""))
        if parts:
            lines.append("- Microsoft 365: " + " · ".join(parts))
        if s["findings"]["kritisch"]:
            lines.append(f"- Offene kritische Sicherheitsbefunde in Microsoft 365: **{s['findings']['kritisch']}**")
        facts = {"mfa_prozent": s["mfa_pct"], "secure_score_prozent": score, "kritische_befunde": s["findings"]["kritisch"]}
    if since:
        rows = db.query("SELECT kind, COUNT(*) AS n FROM staff_changes WHERE customer_id = ? AND status = 'erledigt' "
                        "AND completed_at >= ? AND completed_at < ? GROUP BY kind", (customer_id, since, until or "9999"))
        counts = {r["kind"]: r["n"] for r in rows}
        if counts:
            lines.append("- Mitarbeiterwechsel umgesetzt: " + ", ".join(
                f"**{counts[k]}** {label}" for k, label in (("eintritt", "Eintritt(e)"), ("austritt", "Austritt(e)")) if counts.get(k)))
            facts["ein_austritte"] = counts
    return lines, facts
