"""E-Rechnung im österreichischen Standard ebInterface 6.1 (XML).

Pflicht für Rechnungen an den Bund (Upload über das Unternehmensserviceportal / e-rechnung.gv.at),
bei vielen Ländern, Gemeinden und großen Unternehmen gern gesehen. Für Rechnungen an den Bund
werden zusätzlich Auftragsreferenz (Bestellnummer) und Lieferantennummer benötigt.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any

from .billing import period_bounds
from .db import Database, loads

NS = "http://www.ebinterface.at/schema/6p1/"
UNITS = {"std.": "HUR", "stunde": "HUR", "monat": "MON", "user/monat": "MON", "gerät/monat": "MON"}
NO_VAT_ID = "00000000"  # ebInterface-Konvention, wenn keine UID vorhanden ist


def split_address(text: str) -> dict[str, str]:
    """„Ringstraße 5, 1010 Wien“ oder mehrzeilig → Straße, PLZ, Ort."""
    parts = [p.strip() for p in re.split(r"[\n,]", text or "") if p.strip()]
    street, zip_code, town = "", "", ""
    for p in parts:
        m = re.match(r"^(?:A-|AT-)?(\d{4,5})\s+(.+)$", p)
        if m and not zip_code:
            zip_code, town = m.group(1), m.group(2)
        elif not street:
            street = p
    return {"street": street, "zip": zip_code or "0000", "town": town or "unbekannt"}


def _amount(v: float) -> str:
    return f"{v:.2f}"


def _sub(parent: ET.Element, tag: str, text: str | None = None, **attrs: str) -> ET.Element:
    el = ET.SubElement(parent, f"{{{NS}}}{tag}", {k: v for k, v in attrs.items() if v is not None})
    if text is not None:
        el.text = str(text)
    return el


def _address(parent: ET.Element, name: str, address: str, email: str = "", phone: str = "") -> None:
    a = split_address(address)
    addr = _sub(parent, "Address")
    _sub(addr, "Name", name or "unbekannt")
    if a["street"]:
        _sub(addr, "Street", a["street"])
    _sub(addr, "Town", a["town"])
    _sub(addr, "ZIP", a["zip"])
    _sub(addr, "Country", "Österreich", CountryCode="AT")
    if phone:
        _sub(addr, "Phone", phone)
    if email:
        _sub(addr, "Email", email)


def ebinterface_xml(db: Database, inv: dict[str, Any], profile: dict[str, Any], generator: str = "ME-IT Cockpit") -> bytes:
    if inv["status"] not in ("gestellt", "bezahlt") or not inv["number"]:
        raise ValueError("E-Rechnung nur für gestellte Rechnungen (mit Nummer und Datum)")
    c = db.get("customers", inv["customer_id"]) if inv["customer_id"] else {}
    c = c or {}
    items = loads(inv["items"], [])
    klein = bool(profile.get("kleinunternehmer"))
    rate = 0.0 if klein else float(inv["vat_rate"] or 0)
    category = "E" if klein or rate == 0 else "S"

    ET.register_namespace("", NS)
    root = ET.Element(f"{{{NS}}}Invoice", {
        "GeneratingSystem": generator, "DocumentType": "Invoice", "InvoiceCurrency": "EUR", "Language": "de",
        "DocumentTitle": f"Rechnung {inv['number']}"})
    _sub(root, "InvoiceNumber", inv["number"])
    _sub(root, "InvoiceDate", inv["date"])
    if inv["period"]:
        start, end = period_bounds(inv["period"])
        delivery = _sub(root, "Delivery")
        period = _sub(delivery, "Period")
        _sub(period, "FromDate", start.isoformat())
        _sub(period, "ToDate", end.isoformat())

    biller = _sub(root, "Biller")
    _sub(biller, "VATIdentificationNumber", (profile.get("uid") or NO_VAT_ID).replace(" ", ""))
    _address(biller, profile.get("name", ""), profile.get("address", ""), profile.get("email", ""), profile.get("phone", ""))
    if c.get("supplier_no"):
        _sub(biller, "InvoiceRecipientsBillerID", c["supplier_no"])

    recipient = _sub(root, "InvoiceRecipient")
    _sub(recipient, "VATIdentificationNumber", (c.get("uid") or NO_VAT_ID).replace(" ", ""))
    if inv.get("order_ref"):
        ref = _sub(recipient, "OrderReference")
        _sub(ref, "OrderID", inv["order_ref"])
    _address(recipient, c.get("name") or inv["customer_name"], c.get("address", ""), c.get("email", ""))
    if c.get("contact_name"):
        contact = _sub(recipient, "Contact")
        _sub(contact, "Name", c["contact_name"])

    details = _sub(root, "Details")
    item_list = _sub(details, "ItemList")
    for pos, it in enumerate(items, 1):
        line = _sub(item_list, "ListLineItem")
        _sub(line, "PositionNumber", str(pos))
        _sub(line, "Description", it["description"][:500])
        _sub(line, "Quantity", f"{float(it['quantity']):.4f}".rstrip("0").rstrip(".") or "0",
             Unit=UNITS.get(str(it.get("unit", "")).lower(), "C62"))
        _sub(line, "UnitPrice", f"{float(it['price']):.4f}")
        tax = _sub(line, "TaxItem")
        _sub(tax, "TaxableAmount", _amount(it["total"]))
        _sub(tax, "TaxPercent", f"{rate:g}", TaxCategoryCode=category)
        if klein:
            _sub(tax, "Comment", "Umsatzsteuerfrei – Kleinunternehmer gem. § 6 Abs. 1 Z 27 UStG")
        _sub(line, "LineItemAmount", _amount(it["total"]))

    tax_el = _sub(root, "Tax")
    item = _sub(tax_el, "TaxItem")
    _sub(item, "TaxableAmount", _amount(inv["net"]))
    _sub(item, "TaxPercent", f"{rate:g}", TaxCategoryCode=category)
    _sub(item, "TaxAmount", _amount(inv["vat"] if not klein else 0))
    _sub(root, "TotalGrossAmount", _amount(inv["gross"]))
    _sub(root, "PayableAmount", _amount(inv["gross"]))

    if profile.get("iban"):
        pm = _sub(root, "PaymentMethod")
        _sub(pm, "Comment", "Zahlbar per Überweisung")
        ubt = _sub(pm, "UniversalBankTransaction")
        acc = _sub(ubt, "BeneficiaryAccount")
        if profile.get("bank"):
            _sub(acc, "BankName", profile["bank"])
        if profile.get("bic"):
            _sub(acc, "BIC", profile["bic"].replace(" ", ""))
        _sub(acc, "IBAN", profile["iban"].replace(" ", ""))
        _sub(acc, "BankAccountOwner", profile.get("name", ""))
        _sub(ubt, "PaymentReference", inv["number"][:35])
    if inv["due_date"]:
        cond = _sub(root, "PaymentConditions")
        _sub(cond, "DueDate", inv["due_date"])
    if inv.get("note"):
        _sub(root, "Comment", inv["note"][:1000])
    ET.indent(root)
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="utf-8")
