"""Einmalpositionen und Artikel: Material, Hardware und Pauschalen auf die nächste Rechnung bringen.

- **Artikel:** kleiner Katalog (Bezeichnung, Einheit, Verkaufs- und Einkaufspreis) zum schnellen Auswählen.
- **Einmalpositionen:** was neben Pauschale und Stunden verrechnet wird. Der Rechnungslauf nimmt alle offenen
  Positionen mit Preis mit; wird der Entwurf gelöscht oder die Rechnung storniert, sind sie wieder offen.
- **Material aus Arbeitsberichten** wird beim Abschluss automatisch zur Einmalposition. Fehlt der Preis
  (der Techniker kennt ihn nicht), bleibt die Position als „Preis fehlt“ stehen – verrechnet wird sie erst,
  wenn jemand den Preis einträgt. So geht kein Material verloren und nichts wird zu 0 € verschenkt.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .db import Database, fold, loads

KINDS = {"material": "Material", "hardware": "Hardware", "lizenz": "Lizenz", "pauschale": "Pauschale", "sonstiges": "Sonstiges"}
DAY = r"^\d{4}-\d{2}-\d{2}$"


class ArticleIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    sku: str = Field("", max_length=60)
    unit: str = Field("Stk.", max_length=20)
    price: float = Field(0, ge=0, le=1_000_000)
    cost: Optional[float] = Field(None, ge=0, le=1_000_000)
    vendor: str = Field("", max_length=120)
    notes: str = Field("", max_length=500)
    active: bool = True


class ItemIn(BaseModel):
    customer_id: int
    description: str = Field(min_length=2, max_length=300)
    quantity: float = Field(1, gt=0, le=100_000)
    unit: str = Field("Stk.", max_length=20)
    price: Optional[float] = Field(None, ge=0, le=1_000_000)
    cost: Optional[float] = Field(None, ge=0, le=1_000_000)
    date: Optional[str] = Field(None, pattern=DAY)
    kind: str = Field("material", pattern="^(material|hardware|lizenz|pauschale|sonstiges)$")
    article_id: Optional[int] = None
    ticket_id: Optional[int] = None


class ItemPatch(BaseModel):
    description: Optional[str] = Field(None, min_length=2, max_length=300)
    quantity: Optional[float] = Field(None, gt=0, le=100_000)
    unit: Optional[str] = Field(None, max_length=20)
    price: Optional[float] = Field(None, ge=0, le=1_000_000)
    cost: Optional[float] = Field(None, ge=0, le=1_000_000)
    date: Optional[str] = Field(None, pattern=DAY)
    kind: Optional[str] = Field(None, pattern="^(material|hardware|lizenz|pauschale|sonstiges)$")


def find_article(db: Database, article_id: int | None, name: str) -> dict[str, Any] | None:
    """Artikel über die Nummer oder – ohne Rücksicht auf Groß-/Kleinschreibung – über die genaue Bezeichnung finden."""
    if article_id:
        a = db.get("articles", article_id)
        if a:
            return a
    return db.query_one("SELECT * FROM articles WHERE active = 1 AND fold(name) = ? LIMIT 1", (fold(name.strip()),)) if name.strip() else None


def from_report(db: Database, report: dict[str, Any]) -> int:
    """Material eines abgeschlossenen Arbeitsberichts als Einmalpositionen anlegen – genau einmal je Bericht."""
    if db.scalar("SELECT COUNT(*) FROM billing_items WHERE work_report_id = ?", (report["id"],)):
        return 0
    n = 0
    for m in loads(report["materials"], []):
        name = str(m.get("name") or "").strip()
        if not name:
            continue
        art = find_article(db, m.get("article_id"), name)
        price = m.get("price") if m.get("price") is not None else (art["price"] if art else None)
        # Bezeichnung aus dem Artikel übernehmen – so steht sie einheitlich auf der Rechnung
        db.insert("billing_items", {"customer_id": report["customer_id"], "date": report["date"], "description": (art["name"] if art else name)[:300],
                                    "quantity": float(m.get("qty") or 1), "unit": (m.get("unit") or (art or {}).get("unit") or "Stk.")[:20],
                                    "price": price, "cost": (art or {}).get("cost"), "kind": "material",
                                    "article_id": art["id"] if art else None, "ticket_id": report.get("ticket_id"),
                                    "work_report_id": report["id"], "created_by": report.get("user_id")})
        n += 1
    return n


def open_for_invoice(db: Database, customer_id: int, until: str) -> list[dict[str, Any]]:
    """Offene Positionen mit Preis – die nimmt der Rechnungslauf mit."""
    return db.query("SELECT * FROM billing_items WHERE customer_id = ? AND invoice_id IS NULL AND price IS NOT NULL AND date <= ? "
                    "ORDER BY date, id", (customer_id, until))


def invoice_line(x: dict[str, Any]) -> dict[str, Any]:
    qty = round(x["quantity"], 2)
    return {"kind": "item", "ref": x["id"], "description": x["description"], "quantity": qty, "unit": x["unit"] or "Stk.",
            "price": round(x["price"], 2), "total": round(x["quantity"] * x["price"], 2)}


def unbilled(db: Database) -> dict[str, Any]:
    rows = db.query("SELECT b.customer_id, c.name AS customer, COUNT(*) AS n, SUM(CASE WHEN b.price IS NULL THEN 1 ELSE 0 END) AS unpriced, "
                    "SUM(COALESCE(b.quantity * b.price, 0)) AS value FROM billing_items b LEFT JOIN customers c ON c.id = b.customer_id "
                    "WHERE b.invoice_id IS NULL GROUP BY b.customer_id ORDER BY value DESC")
    return {"customers": [{**r, "value": round(r["value"] or 0, 2)} for r in rows], "value": round(sum(r["value"] or 0 for r in rows), 2),
            "unpriced": sum(r["unpriced"] or 0 for r in rows)}


def register(app: FastAPI, ctx: Any, admin_only) -> None:
    db: Database = ctx.db

    def view(r: dict[str, Any]) -> dict[str, Any]:
        total = round(r["quantity"] * r["price"], 2) if r["price"] is not None else None
        margin = round(r["quantity"] * (r["price"] - r["cost"]), 2) if r["price"] is not None and r["cost"] is not None else None
        return {**{k: r[k] for k in ("id", "customer_id", "date", "description", "quantity", "unit", "price", "cost", "kind", "article_id",
                                     "ticket_id", "work_report_id", "invoice_id", "created_at")},
                "customer": r.get("customer") or "", "report": r.get("report") or "", "invoice": r.get("invoice") or "",
                "total": total, "margin": margin, "kind_label": KINDS.get(r["kind"], r["kind"]),
                "status": "verrechnet" if r["invoice_id"] else "Preis fehlt" if r["price"] is None else "offen"}

    select = ("SELECT b.*, c.name AS customer, w.number AS report, COALESCE(NULLIF(i.number, ''), CASE WHEN i.id IS NULL THEN '' ELSE 'Entwurf' END) AS invoice "
              "FROM billing_items b LEFT JOIN customers c ON c.id = b.customer_id LEFT JOIN work_reports w ON w.id = b.work_report_id "
              "LEFT JOIN invoices i ON i.id = b.invoice_id ")

    def need(iid: int, writable: bool = False) -> dict[str, Any]:
        r = db.query_one(select + "WHERE b.id = ?", (iid,))
        if not r:
            raise HTTPException(404, "Position nicht gefunden")
        if writable and r["invoice_id"]:
            raise HTTPException(409, "Diese Position steht schon auf einer Rechnung. Erst den Entwurf löschen oder die Rechnung stornieren.")
        return r

    # --- Artikel -----------------------------------------------------------------------------------
    @app.get("/api/articles")
    def articles(all: bool = False) -> list[dict]:  # noqa: A002
        return db.query("SELECT * FROM articles " + ("" if all else "WHERE active = 1 ") + "ORDER BY lower(name)")

    @app.post("/api/articles", status_code=201, dependencies=[Depends(admin_only)])
    def add_article(data: ArticleIn) -> dict:
        return db.get("articles", db.insert("articles", data.model_dump()))

    @app.put("/api/articles/{aid}", dependencies=[Depends(admin_only)])
    def edit_article(aid: int, data: ArticleIn) -> dict:
        if not db.get("articles", aid):
            raise HTTPException(404, "Artikel nicht gefunden")
        db.update("articles", aid, data.model_dump())
        return db.get("articles", aid)

    @app.delete("/api/articles/{aid}", dependencies=[Depends(admin_only)])
    def drop_article(aid: int) -> dict:
        if not db.get("articles", aid):
            raise HTTPException(404, "Artikel nicht gefunden")
        if db.scalar("SELECT COUNT(*) FROM billing_items WHERE article_id = ?", (aid,)):
            db.update("articles", aid, {"active": False})  # schon verwendet → nur ausblenden, Positionen behalten ihren Bezug
            return {"ok": True, "archived": True}
        db.delete("articles", aid)
        return {"ok": True, "archived": False}

    # --- Einmalpositionen ----------------------------------------------------------------------------
    @app.get("/api/billing/items")
    def list_items(status: str = "offen", customer_id: int = 0, limit: int = 300) -> dict:
        where, params = [], []
        if status == "offen":
            where.append("b.invoice_id IS NULL")
        elif status == "verrechnet":
            where.append("b.invoice_id IS NOT NULL")
        if customer_id:
            where.append("b.customer_id = ?")
            params.append(customer_id)
        rows = db.query(select + ("WHERE " + " AND ".join(where) + " " if where else "") + "ORDER BY b.invoice_id IS NOT NULL, b.date DESC, b.id DESC LIMIT ?",
                        [*params, max(1, min(limit, 1000))])
        return {"items": [view(r) for r in rows], "summary": unbilled(db), "kinds": KINDS}

    @app.post("/api/billing/items", status_code=201, dependencies=[Depends(admin_only)])
    def add_item(data: ItemIn, request: Request) -> dict:
        if not db.get("customers", data.customer_id):
            raise HTTPException(404, "Kunde nicht gefunden")
        d = data.model_dump()
        art = find_article(db, d["article_id"], d["description"])
        if art:
            d["article_id"] = art["id"]
            d["cost"] = d["cost"] if d["cost"] is not None else art["cost"]
        u = getattr(request.state, "user", None)
        iid = db.insert("billing_items", {**d, "date": d["date"] or date.today().isoformat(), "created_by": u["id"] if isinstance(u, dict) else None})
        return view(need(iid))

    @app.put("/api/billing/items/{iid}", dependencies=[Depends(admin_only)])
    def edit_item(iid: int, data: ItemPatch) -> dict:
        need(iid, writable=True)
        patch = data.model_dump(exclude_unset=True)
        if patch:
            db.update("billing_items", iid, patch)
        return view(need(iid))

    @app.delete("/api/billing/items/{iid}", dependencies=[Depends(admin_only)])
    def drop_item(iid: int) -> dict:
        need(iid, writable=True)
        db.delete("billing_items", iid)
        return {"ok": True}
