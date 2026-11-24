"""Ansprechpartner je Kunde – aus Atera übernommen oder von Hand angelegt.

Ein Kunde hat oft mehrere Menschen: Geschäftsführung, Büro, den „IT-Zuständigen“. Hier stehen alle mit Funktion,
E-Mail und Telefon; einer ist der Hauptkontakt. Auffindbar über die Suche („Wer ist Frau Maier?“).
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .db import Database

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ContactIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field("", max_length=200)
    phone: str = Field("", max_length=60)
    job_title: str = Field("", max_length=120)
    is_primary: bool = False
    notes: str = Field("", max_length=500)


def register(app: FastAPI, ctx: Any) -> None:
    db: Database = ctx.db

    def clean(data: ContactIn) -> dict[str, Any]:
        d = data.model_dump()
        d["email"] = d["email"].strip()
        if d["email"] and not EMAIL.match(d["email"]):
            raise HTTPException(422, "Bitte eine gültige E-Mail-Adresse eingeben.")
        return d

    def only_one_primary(customer_id: int, keep: int) -> None:
        db.query("UPDATE contacts SET is_primary = 0 WHERE customer_id = ? AND id != ?", (customer_id, keep))

    @app.get("/api/customers/{cid}/contacts")
    def list_contacts(cid: int) -> list[dict]:
        return db.query("SELECT * FROM contacts WHERE customer_id = ? ORDER BY is_primary DESC, lower(name)", (cid,))

    @app.post("/api/customers/{cid}/contacts", status_code=201)
    def add_contact(cid: int, data: ContactIn) -> dict:
        if not db.get("customers", cid):
            raise HTTPException(404, "Kunde nicht gefunden")
        d = clean(data)
        new_id = db.insert("contacts", {**d, "customer_id": cid, "source": "cockpit"})
        if d["is_primary"]:
            only_one_primary(cid, new_id)
        return db.get("contacts", new_id)

    @app.put("/api/contacts/{contact_id}")
    def edit_contact(contact_id: int, data: ContactIn) -> dict:
        c = db.get("contacts", contact_id)
        if not c:
            raise HTTPException(404, "Ansprechpartner nicht gefunden")
        d = clean(data)
        db.update("contacts", contact_id, d)
        if d["is_primary"]:
            only_one_primary(c["customer_id"], contact_id)
        return db.get("contacts", contact_id)

    @app.delete("/api/contacts/{contact_id}")
    def drop_contact(contact_id: int) -> dict:
        if not db.get("contacts", contact_id):
            raise HTTPException(404, "Ansprechpartner nicht gefunden")
        db.delete("contacts", contact_id)
        return {"ok": True}
