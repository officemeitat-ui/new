"""Team: Benutzer & Rollen, Login, Aktivitäten, Wochenrhythmus (Ziel am Montag, Abgleich am Freitag).

Solange kein Benutzer angelegt ist, läuft das Cockpit im Einzelplatz-Modus (offen wie bisher).
Sobald der erste Benutzer (Admin) existiert, ist eine Anmeldung Pflicht.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .db import Database, loads, now_iso

ROLES = {"admin": "Geschäftsführung/Admin", "technik": "Technik", "vertrieb": "Vertrieb"}
ACTIVITY_TYPES = {
    "anruf": "Anrufe", "erstgespraech": "Erstgespräche", "pitch": "Pitches", "angebot": "Angebotsbesprechungen",
    "angebot_erstellt": "Angebote erstellt", "abschluss": "Abschlüsse", "qbr": "QBRs", "ticket_geloest": "Tickets gelöst",
    "termin": "Termine", "email": "E-Mails", "notiz": "Notizen", "gewonnen": "Leads gewonnen", "verloren": "Leads verloren",
}
GOAL_TYPES = ["anruf", "erstgespraech", "pitch", "angebot", "abschluss", "qbr", "ticket_geloest"]
SESSION_COOKIE = "meit_session"
SESSION_DAYS = 14
PBKDF2_ROUNDS = 260_000


# ------------------------------------------------------------------------ Passwörter
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS).hex()
    return f"pbkdf2${PBKDF2_ROUNDS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, digest = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds)).hex()
        return hmac.compare_digest(calc, digest)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def users_exist(db: Database) -> bool:
    return bool(db.scalar("SELECT COUNT(*) FROM users WHERE active = 1"))


def user_from_token(db: Database, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    row = db.query_one(
        "SELECT u.id, u.name, u.email, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token_hash = ? AND u.active = 1", (_token_hash(token),))
    if not row or row["expires_at"] < now_iso():
        return None
    return {k: row[k] for k in ("id", "name", "email", "role")}


def public_user(u: dict[str, Any]) -> dict[str, Any]:
    return {k: u[k] for k in ("id", "name", "email", "role", "active", "last_login_at", "created_at") if k in u}


# ------------------------------------------------------------------------ Aktivitäten
def log_activity(db: Database, user_id: int | None, type_: str, ref_type: str = "", ref_id: int | None = None,
                 note: str = "") -> int:
    return db.insert("activities", {"user_id": user_id, "type": type_, "ref_type": ref_type, "ref_id": ref_id,
                                    "note": note[:500]})


def current_user_id(request: Request) -> int | None:
    user = getattr(request.state, "user", None)
    return user["id"] if user else None


def iso_week(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def week_range(week: str) -> tuple[str, str]:
    y, w = week.split("-W")
    monday = date.fromisocalendar(int(y), int(w), 1)
    return monday.isoformat(), (monday + timedelta(days=7)).isoformat()


def week_overview(db: Database, week: str) -> dict[str, Any]:
    start, end = week_range(week)
    users = db.query("SELECT id, name, role FROM users WHERE active = 1 ORDER BY name")
    if not users:
        users = [{"id": None, "name": "Team", "role": "admin"}]
    rows = []
    for u in users:
        if u["id"] is None:
            acts = db.query("SELECT type, COUNT(*) AS n FROM activities WHERE created_at >= ? AND created_at < ? "
                            "GROUP BY type", (start, end))
            goal_row = db.query_one("SELECT * FROM weekly_goals WHERE user_id = 0 AND week = ?", (week,))
        else:
            acts = db.query("SELECT type, COUNT(*) AS n FROM activities WHERE user_id = ? AND created_at >= ? "
                            "AND created_at < ? GROUP BY type", (u["id"], start, end))
            goal_row = db.query_one("SELECT * FROM weekly_goals WHERE user_id = ? AND week = ?", (u["id"], week))
        actual = {a["type"]: a["n"] for a in acts}
        goals = loads(goal_row["goals"], {}) if goal_row else {}
        reached = [t for t, g in goals.items() if g and actual.get(t, 0) >= g]
        rows.append({"user_id": u["id"] or 0, "name": u["name"], "role": u["role"], "goals": goals, "actual": actual,
                     "review_note": goal_row["review_note"] if goal_row else "",
                     "fulfilled": f"{len(reached)}/{sum(1 for g in goals.values() if g)}"})
    top = db.query(
        "SELECT l.id, l.name, l.company, l.stage, l.score, l.next_step, l.risk, l.owner_id, u.name AS owner "
        "FROM leads l LEFT JOIN users u ON u.id = l.owner_id WHERE l.stage IN ('erstgespraech', 'pitch', 'angebot') "
        "ORDER BY CASE l.stage WHEN 'angebot' THEN 0 WHEN 'pitch' THEN 1 ELSE 2 END, l.score DESC LIMIT 10")
    return {"week": week, "start": start, "end": end, "rows": rows, "top_opportunities": top,
            "goal_types": {t: ACTIVITY_TYPES[t] for t in GOAL_TYPES}, "activity_types": ACTIVITY_TYPES}


# ------------------------------------------------------------------------ API
class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    role: str = "technik"
    password: Optional[str] = Field(None, max_length=200)
    active: bool = True


class ActivityIn(BaseModel):
    type: str
    ref_type: str = ""
    ref_id: Optional[int] = None
    note: str = Field("", max_length=500)


class GoalsIn(BaseModel):
    week: str = Field(pattern=r"^\d{4}-W\d{2}$")
    user_id: int = 0
    goals: dict[str, int] = {}
    review_note: str = Field("", max_length=2000)


def make_admin_dependency(db: Database):
    def admin_only(request: Request) -> None:
        if not users_exist(db):
            return  # Einzelplatz-Modus
        user = getattr(request.state, "user", None)
        if not user or user["role"] != "admin":
            raise HTTPException(403, "Nur für Admins (Geschäftsführung).")
    return admin_only


def register(app: FastAPI, db: Database, login_limiter) -> None:
    admin_only = make_admin_dependency(db)

    @app.get("/api/auth/status")
    def auth_status(request: Request) -> dict:
        return {"login_required": users_exist(db), "user": getattr(request.state, "user", None), "roles": ROLES}

    @app.post("/api/auth/login")
    def login(data: LoginIn, request: Request, response: Response) -> dict:
        client = request.client.host if request.client else "?"
        if not login_limiter.allow(f"login:{client}"):
            raise HTTPException(429, "Zu viele Versuche – bitte in einigen Minuten erneut.")
        user = db.query_one("SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1", (data.email.strip(),))
        if not user or not verify_password(data.password, user["password_hash"]):
            raise HTTPException(401, "E-Mail oder Passwort falsch.")
        token = secrets.token_urlsafe(32)
        expires = (datetime.now() + timedelta(days=SESSION_DAYS)).replace(microsecond=0).isoformat(sep=" ")
        with db.connect() as conn:
            conn.execute("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                         (_token_hash(token), user["id"], expires, now_iso()))
            conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now_iso(),))
        db.update("users", user["id"], {"last_login_at": now_iso()})
        response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="strict",
                            secure=request.url.scheme == "https", path="/")
        return {"user": public_user(user)}

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response) -> dict:
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            with db.connect() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
        response.delete_cookie(SESSION_COOKIE, path="/")
        return {"ok": True}

    # --- Benutzerverwaltung (Admin) -------------------------------------------
    @app.get("/api/users")
    def list_users() -> list[dict]:
        return [public_user(u) for u in db.query("SELECT * FROM users ORDER BY active DESC, name")]

    @app.post("/api/users", status_code=201, dependencies=[Depends(admin_only)])
    def add_user(data: UserIn) -> dict:
        if data.role not in ROLES:
            raise HTTPException(422, "Unbekannte Rolle")
        if not data.password or len(data.password) < 10:
            raise HTTPException(422, "Passwort mit mindestens 10 Zeichen angeben.")
        if not users_exist(db) and data.role != "admin":
            raise HTTPException(422, "Der erste Benutzer muss Admin sein.")
        if db.query_one("SELECT id FROM users WHERE lower(email) = lower(?)", (data.email,)):
            raise HTTPException(409, "E-Mail existiert bereits")
        uid = db.insert("users", {"name": data.name, "email": data.email.strip().lower(), "role": data.role,
                                  "password_hash": hash_password(data.password), "active": data.active})
        return public_user(db.get("users", uid))

    @app.put("/api/users/{uid}", dependencies=[Depends(admin_only)])
    def update_user(uid: int, data: UserIn, request: Request) -> dict:
        u = db.get("users", uid)
        if not u:
            raise HTTPException(404, "Benutzer nicht gefunden")
        if data.role not in ROLES:
            raise HTTPException(422, "Unbekannte Rolle")
        fields: dict[str, Any] = {"name": data.name, "email": data.email.strip().lower(), "role": data.role,
                                  "active": data.active}
        if data.password:
            if len(data.password) < 10:
                raise HTTPException(422, "Passwort mit mindestens 10 Zeichen angeben.")
            fields["password_hash"] = hash_password(data.password)
        remaining_admins = db.scalar("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?", (uid,))
        if u["role"] == "admin" and (data.role != "admin" or not data.active) and not remaining_admins:
            raise HTTPException(422, "Es muss mindestens ein aktiver Admin bleiben.")
        db.update("users", uid, fields)
        if not data.active or data.password:
            with db.connect() as conn:  # Sitzungen beenden
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        return public_user(db.get("users", uid))

    # --- Aktivitäten & Wochenrhythmus ------------------------------------------
    @app.post("/api/activities", status_code=201)
    def add_activity(data: ActivityIn, request: Request) -> dict:
        if data.type not in ACTIVITY_TYPES:
            raise HTTPException(422, "Unbekannte Aktivität")
        aid = log_activity(db, current_user_id(request), data.type, data.ref_type, data.ref_id, data.note)
        return db.get("activities", aid)

    @app.get("/api/activities")
    def list_activities(limit: int = 50, ref_type: Optional[str] = None, ref_id: Optional[int] = None) -> list[dict]:
        sql = ("SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE 1=1")
        params: list[Any] = []
        if ref_type:
            sql += " AND a.ref_type = ?"
            params.append(ref_type)
        if ref_id:
            sql += " AND a.ref_id = ?"
            params.append(ref_id)
        return db.query(sql + " ORDER BY a.id DESC LIMIT ?", [*params, min(limit, 500)])

    @app.get("/api/team/week")
    def team_week(week: Optional[str] = None) -> dict:
        week = week or iso_week(date.today())
        try:
            week_range(week)
        except (ValueError, IndexError):
            raise HTTPException(422, "Woche im Format JJJJ-Www angeben")
        return week_overview(db, week)

    @app.put("/api/team/goals")
    def set_goals(data: GoalsIn, request: Request) -> dict:
        user = getattr(request.state, "user", None)
        if users_exist(db) and user and user["role"] != "admin" and data.user_id != user["id"]:
            raise HTTPException(403, "Nur eigene Ziele (oder als Admin)")
        goals = {k: max(0, int(v)) for k, v in data.goals.items() if k in ACTIVITY_TYPES}
        import json as _json
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO weekly_goals (user_id, week, goals, review_note, created_at) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(user_id, week) DO UPDATE SET goals = excluded.goals, review_note = excluded.review_note",
                (data.user_id, data.week, _json.dumps(goals), data.review_note, now_iso()))
        return week_overview(db, data.week)
