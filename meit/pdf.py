"""PDF-Dokumente im ME-IT Corporate Design (fpdf2, reines Python – kein Browser nötig).

* Rechnung (strukturiert, Pflichtangaben § 11 UStG)
* Angebote, Monatsberichte, QBR, Security-Berichte (aus dem Markdown-Text der Agenten)
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Any

from fpdf import FPDF

from .branding import hex_to_rgb

FONTS = Path(__file__).parent / "static" / "fonts"
# Zeichen, die in KI-Texten vorkommen, aber nicht in der (Latin-)Schrift enthalten sind
GLYPH_FIX = {"▲": "+", "▼": "−", "↑": "+", "↓": "−", "→": "–", "←": "–", "⇒": "–", "✓": "", "✔": "", "✅": "",
             "☑": "", "❌": "", "✗": "", "✘": "", "⚠": "!", "\u00a0": " ", "\u2009": " ", "\u202f": " "}
_SUPPORTED: set[int] | None = None


def _supported() -> set[int]:
    global _SUPPORTED
    if _SUPPORTED is None:
        from fontTools.ttLib import TTFont

        _SUPPORTED = set(TTFont(str(FONTS / "Roboto-Regular.ttf")).getBestCmap())
    return _SUPPORTED


def _eur(v: float) -> str:
    return "€ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _d(iso: str) -> str:
    return f"{iso[8:10]}.{iso[5:7]}.{iso[0:4]}" if iso and len(iso) >= 10 else "–"


def clean(text: str) -> str:
    """Nicht darstellbare Zeichen (Emojis, Symbole) ersetzen bzw. entfernen."""
    for k, v in GLYPH_FIX.items():
        text = text.replace(k, v)
    ok = _supported()
    text = "".join(ch for ch in text if ord(ch) in ok or ch in "\n\t")
    return re.sub(r"(?<=\S) {2,}(?=\S)", " ", text).strip(" ")


class BrandPDF(FPDF):
    def __init__(self, branding: dict[str, Any], profile: dict[str, Any], logo: Path, title: str = ""):
        super().__init__(format="A4")
        self.b, self.p, self.logo, self.doc_title = branding, profile, logo, title
        self.add_font("Roboto", "", str(FONTS / "Roboto-Regular.ttf"))
        self.add_font("Roboto", "B", str(FONTS / "Roboto-Bold.ttf"))
        self.set_margins(20, 18, 20)
        self.set_auto_page_break(True, margin=26)
        self.set_title(title or branding.get("name", ""))
        self.set_author(profile.get("name", ""))
        self.set_creator("ME-IT Cockpit")

    def color(self, key: str) -> tuple[int, int, int]:
        return hex_to_rgb(self.b.get(key) or "#17252a")

    def header(self) -> None:
        self.set_fill_color(*self.color("brand"))
        self.rect(0, 0, 210, 3, "F")
        try:
            self.image(str(self.logo), x=20, y=10, h=20)
        except Exception:  # noqa: BLE001 - ungültiges Logo darf kein PDF verhindern
            self.set_font("Roboto", "B", 16)
            self.set_xy(20, 14)
            self.cell(0, 8, self.p.get("name", ""))
        self.set_font("Roboto", "", 8)
        self.set_text_color(*self.color("anthracite"))
        lines = [self.p.get("name", "")] + [l.strip() for l in (self.p.get("address") or "").splitlines() if l.strip()]
        lines += [x for x in (self.p.get("phone"), self.p.get("email"), self.b.get("website")) if x]
        self.set_xy(110, 10)
        for line in lines[:7]:
            self.set_x(110)
            self.cell(80, 3.8, clean(line), align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_y(36)
        self.set_text_color(*self.color("dark"))

    def footer(self) -> None:
        self.set_y(-18)
        self.set_draw_color(*self.color("brand"))
        self.set_line_width(0.4)
        self.line(20, self.get_y(), 190, self.get_y())
        self.set_font("Roboto", "", 7)
        self.set_text_color(*self.color("anthracite"))
        parts = [self.p.get("name", ""), f"UID {self.p['uid']}" if self.p.get("uid") else "",
                 f"IBAN {self.p['iban']}" if self.p.get("iban") else "", f"BIC {self.p['bic']}" if self.p.get("bic") else "",
                 self.b.get("website", "")]
        self.set_y(-15)
        self.cell(0, 4, clean("  ·  ".join(p for p in parts if p)), align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 4, clean(f"{self.b.get('tagline', '')}   ·   Seite {self.page_no()}/{{nb}}"), align="C")

    def heading(self, text: str, size: int = 16, accent: bool = True) -> None:
        self.set_font("Roboto", "B", size)
        self.set_text_color(*self.color("dark"))
        self.multi_cell(0, size * 0.5, clean(text), align="L", new_x="LMARGIN", new_y="NEXT")
        if accent:
            self.set_fill_color(*self.color("accent"))
            self.rect(self.l_margin, self.get_y() + 1, 14, 1, "F")
            self.ln(4)

    def text_block(self, text: str, size: float = 10, bold: bool = False, color: str = "dark", h: float = 5) -> None:
        self.set_font("Roboto", "B" if bold else "", size)
        self.set_text_color(*self.color(color))
        self.multi_cell(0, h, clean(text), markdown=True, align="L", new_x="LMARGIN", new_y="NEXT")


def valid_iban(iban: str) -> bool:
    """Prüfziffer nach ISO 13616 (mod 97)."""
    iban = re.sub(r"\s+", "", iban or "").upper()
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", iban):
        return False
    digits = "".join(str(int(ch, 36)) for ch in iban[4:] + iban[:4])
    return int(digits) % 97 == 1


def epc_payload(name: str, iban: str, amount: float, reference: str, bic: str = "") -> str:
    """Inhalt für den EPC-QR-Code („Zahlen mit Code“, GiroCode) nach EPC069-12, Version 002."""
    lines = ["BCD", "002", "1", "SCT", re.sub(r"\s+", "", bic or "").upper(), clean(name)[:70],
             re.sub(r"\s+", "", iban).upper(), f"EUR{amount:.2f}", "", "", clean(reference)[:140]]
    return "\n".join(lines)


def payment_qr(profile: dict[str, Any], amount: float, reference: str) -> str:
    """EPC-Inhalt, wenn IBAN gültig und Betrag zahlbar – sonst leer (dann ohne QR-Code)."""
    if amount < 0.01 or amount > 999_999_999 or not valid_iban(profile.get("iban", "")):
        return ""
    return epc_payload(profile.get("name") or "", profile["iban"], amount, reference, profile.get("bic", ""))


def _draw_qr(pdf: FPDF, x: float, y: float, size: float, payload: str) -> bool:
    try:
        import segno
    except ImportError:  # optional – ohne segno einfach ohne QR-Code
        return False
    rows = [list(r) for r in segno.make(payload, error="m", micro=False, encoding="utf-8",
                                        boost_error=False).matrix_iter(border=0)]
    n = len(rows)
    m = size / n
    pdf.set_fill_color(0, 0, 0)
    for r, row in enumerate(rows):
        c = 0
        while c < n:
            if not row[c]:
                c += 1
                continue
            start = c
            while c < n and row[c]:
                c += 1
            pdf.rect(x + start * m, y + r * m, (c - start) * m, m + 0.02, "F")
    return True


def _recipient(pdf: "BrandPDF", customer: dict[str, Any], fallback_name: str = "") -> None:
    pdf.set_y(48)
    pdf.set_font("Roboto", "B", 10)
    pdf.set_text_color(*pdf.color("dark"))
    pdf.cell(0, 5, clean(customer.get("name") or fallback_name), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Roboto", "", 10)
    for line in [customer.get("contact_name", "")] + re.split(r"[\n,]", customer.get("address") or ""):
        if line and line.strip():
            pdf.cell(0, 5, clean(line.strip()), new_x="LMARGIN", new_y="NEXT")
    if customer.get("uid"):
        pdf.cell(0, 5, clean(f"UID: {customer['uid']}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(10)


def _payment_block(pdf: "BrandPDF", profile: dict[str, Any], text: str, qr: str) -> None:
    """Zahlungshinweis, rechts daneben der QR-Code zum Scannen mit der Banking-App."""
    size = 30
    if not qr:
        pdf.text_block(text, size=9.5)
        return
    if pdf.get_y() + size + 8 > pdf.page_break_trigger:
        pdf.add_page()
        pdf.set_y(40)
    y = pdf.get_y()
    if not _draw_qr(pdf, 190 - size, y, size, qr):
        pdf.text_block(text, size=9.5)
        return
    pdf.set_xy(190 - size - 4, y + size + 0.5)
    pdf.set_font("Roboto", "", 7)
    pdf.set_text_color(*pdf.color("anthracite"))
    pdf.cell(size + 8, 3.5, "Zahlen mit Code – mit der Banking-App scannen", align="C")
    pdf.set_xy(20, y)
    pdf.set_font("Roboto", "", 9.5)
    pdf.set_text_color(*pdf.color("dark"))
    pdf.multi_cell(170 - size - 8, 5, clean(text), markdown=True, align="L", new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(max(pdf.get_y(), y + size + 6))


def invoice_pdf(inv: dict[str, Any], items: list[dict[str, Any]], customer: dict[str, Any], profile: dict[str, Any],
                branding: dict[str, Any], logo: Path, period: tuple[date, date] | None) -> bytes:
    draft = inv["status"] == "entwurf"
    pdf = BrandPDF(branding, profile, logo, f"Rechnung {inv['number'] or 'Entwurf'}")
    pdf.alias_nb_pages()
    pdf.add_page()
    _recipient(pdf, customer, inv.get("customer_name", ""))
    pdf.heading("RECHNUNGSENTWURF" if draft else f"Rechnung {inv['number']}")
    meta = [f"Rechnungsdatum: {_d(inv['date']) if inv['date'] else '–'}"]
    if period:
        meta.append(f"Leistungszeitraum: {_d(period[0].isoformat())} – {_d(period[1].isoformat())}")
    if inv.get("due_date"):
        meta.append(f"Fällig: {_d(inv['due_date'])}")
    if inv.get("order_ref"):
        meta.append(f"Ihre Bestellnummer: {inv['order_ref']}")
    pdf.text_block("   ·   ".join(meta), size=9, color="anthracite")
    pdf.ln(4)

    widths = (12, 92, 22, 22, 22)

    def table_head() -> None:
        pdf.set_font("Roboto", "B", 8.5)
        pdf.set_text_color(*pdf.color("anthracite"))
        for w, label, align in zip(widths, ("POS.", "LEISTUNG", "MENGE", "EINZELPREIS", "GESAMT"), "LLRRR"):
            pdf.cell(w, 7, label, align=align)
        pdf.ln(7)
        pdf.set_draw_color(*pdf.color("brand"))
        pdf.set_line_width(0.5)
        pdf.line(20, pdf.get_y(), 190, pdf.get_y())
        pdf.set_line_width(0.2)
        pdf.set_draw_color(220, 228, 230)
        pdf.set_font("Roboto", "", 9.5)
        pdf.set_text_color(*pdf.color("dark"))

    table_head()
    for n, it in enumerate(items, 1):
        desc = clean(it["description"])
        row_h = pdf.multi_cell(widths[1] - 2, 5, desc, dry_run=True, output="HEIGHT") + 3
        if pdf.get_y() + row_h > pdf.page_break_trigger:
            pdf.add_page()
            pdf.set_y(40)
            table_head()
        y0 = pdf.get_y() + 1.5
        pdf.set_xy(20, y0)
        pdf.cell(widths[0], 5, str(n))
        pdf.multi_cell(widths[1] - 2, 5, desc, align="L", new_x="RIGHT", new_y="TOP")
        qty = f"{float(it['quantity']):g}".replace(".", ",") + f" {it.get('unit', '')}"
        pdf.set_xy(20 + widths[0] + widths[1], y0)
        pdf.cell(widths[2], 5, clean(qty), align="R")
        pdf.cell(widths[3], 5, _eur(it["price"]), align="R")
        pdf.cell(widths[4], 5, _eur(it["total"]), align="R")
        pdf.set_y(y0 - 1.5 + row_h)
        pdf.line(20, pdf.get_y(), 190, pdf.get_y())

    def total_row(label: str, value: str, bold: bool = False, line: bool = False) -> None:
        if line:
            pdf.set_draw_color(*pdf.color("brand"))
            pdf.set_line_width(0.6)
            pdf.line(110, pdf.get_y() + 1, 190, pdf.get_y() + 1)
            pdf.set_line_width(0.2)
        pdf.set_font("Roboto", "B" if bold else "", 11 if bold else 9.5)
        pdf.set_x(20)
        pdf.cell(148, 7, clean(label), align="R")
        pdf.cell(22, 7, value, align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(2)
    total_row("Summe netto", _eur(inv["net"]))
    if profile.get("kleinunternehmer"):
        total_row("Umsatzsteuerfrei – Kleinunternehmer gem. § 6 Abs. 1 Z 27 UStG", "")
    else:
        total_row(f"zzgl. {float(inv['vat_rate']):g} % USt".replace(".", ","), _eur(inv["vat"]))
    total_row("Gesamtbetrag", _eur(inv["gross"]), bold=True, line=True)
    pdf.ln(6)
    if inv.get("note"):
        pdf.text_block(inv["note"], size=9.5)
        pdf.ln(2)
    pay = (f"Bitte überweisen Sie den Betrag bis {_d(inv['due_date'])} ohne Abzug"
           if inv.get("due_date") else "Bitte überweisen Sie den Betrag ohne Abzug")
    if profile.get("iban"):
        pay += f" auf {profile.get('bank') or 'unser Konto'}, IBAN {profile['iban']}"
        if profile.get("bic"):
            pay += f", BIC {profile['bic']}"
    pay += f". Verwendungszweck: {inv['number'] or '–'}."
    qr = payment_qr(profile, float(inv["gross"]), f"Rechnung {inv['number']}") \
        if inv.get("number") and inv["status"] in ("gestellt", "bezahlt") else ""
    _payment_block(pdf, profile, pay, qr)
    if profile.get("footer"):
        pdf.ln(2)
        pdf.text_block(profile["footer"], size=9.5, color="anthracite")
    return bytes(pdf.output())


def _is_num(value: str) -> bool:
    v = value.strip()
    if re.fullmatch(r"\d{1,2}\.\d{1,2}\.(\d{2}|\d{4})?", v):  # Datum (z. B. 17.11.2026) bleibt linksbündig
        return False
    return bool(re.fullmatch(r"[€+\-−–]?\s*[\d.,\s]+\s*(%|€|h|Std\.?|EUR)?", v))


def _numeric_column(rows: list[list[str]], ci: int) -> bool:
    values = [r[ci].strip() for r in rows[1:] if ci < len(r) and r[ci].strip() not in ("", "–", "-")]
    return bool(values) and all(_is_num(v) for v in values)


def _col_widths(pdf: FPDF, rows: list[list[str]], ncol: int, numeric: list[bool], total: float = 170) -> list[float]:
    """Spaltenbreiten nach Inhalt: Zahlenspalten ohne Umbruch, Textspalten mindestens so breit wie ihr längstes Wort."""
    natural, minimum = [], []
    for ci in range(ncol):
        full, word = [10.0], [10.0]
        for ri, r in enumerate(rows):
            if ci >= len(r):
                continue
            pdf.set_font("Roboto", "B" if ri == 0 else "", 8.5 if ri == 0 else 9)
            text = clean(r[ci])
            full.append(pdf.get_string_width(text))
            word.extend(pdf.get_string_width(w) for w in text.split())
        natural.append(max(full) + 5)
        minimum.append(natural[-1] if numeric[ci] else min(max(word) + 5, 45))
    if sum(natural) <= total:  # alles passt → Rest der breitesten Spalte geben
        widest = natural.index(max(natural))
        natural[widest] += total - sum(natural)
        return natural
    if sum(minimum) >= total:
        return [w * total / sum(minimum) for w in minimum]
    spare = total - sum(minimum)
    growth = [natural[ci] - minimum[ci] for ci in range(ncol)]
    return [minimum[ci] + spare * growth[ci] / (sum(growth) or 1) for ci in range(ncol)]


def markdown_pdf(title: str, text: str, profile: dict[str, Any], branding: dict[str, Any], logo: Path,
                 subtitle: str = "") -> bytes:
    """Einfacher Markdown-Satz (Überschriften, Absätze, Listen, Tabellen, **fett**) im Corporate Design."""
    pdf = BrandPDF(branding, profile, logo, title)
    pdf.alias_nb_pages()
    pdf.add_page()
    if subtitle:
        pdf.text_block(subtitle, size=9, color="anthracite")
        pdf.ln(2)
    lines = text.splitlines()
    i = 0
    first_h1 = True
    while i < len(lines):
        raw = lines[i].rstrip()
        line = re.sub(r"(^|[\s(])_([^_]+)_(?=[\s).,]|$)", r"\1\2", raw)  # _kursiv_ → normal
        if not line.strip():
            pdf.ln(2)
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                if lines[i].replace("|", "").replace("-", "").replace(":", "").strip():
                    rows.append([c.strip().replace("**", "") for c in lines[i].strip().strip("|").split("|")])
                i += 1
            ncol = max(len(r) for r in rows)
            numeric = [_numeric_column(rows, ci) for ci in range(ncol)]
            widths = _col_widths(pdf, rows, ncol, numeric)
            for ri, r in enumerate(rows):
                pdf.set_font("Roboto", "B" if ri == 0 else "", 8.5 if ri == 0 else 9)
                pdf.set_text_color(*pdf.color("anthracite" if ri == 0 else "dark"))
                y0 = pdf.get_y()
                heights = []
                for ci in range(ncol):
                    cell = clean(r[ci] if ci < len(r) else "")
                    heights.append(pdf.multi_cell(widths[ci] - 1.5, 5, cell, dry_run=True, output="HEIGHT"))
                row_h = max(heights) + 2
                if y0 + row_h > pdf.page_break_trigger:
                    pdf.add_page()
                    y0 = pdf.get_y()
                x = pdf.l_margin
                for ci in range(ncol):
                    pdf.set_xy(x, y0 + 1)
                    pdf.multi_cell(widths[ci] - 1.5, 5, clean(r[ci] if ci < len(r) else ""),
                                   align="R" if numeric[ci] else "L")
                    x += widths[ci]
                pdf.set_y(y0 + row_h)
                pdf.set_draw_color(*(pdf.color("brand") if ri == 0 else (220, 228, 230)))
                pdf.line(pdf.l_margin, pdf.get_y(), 190, pdf.get_y())
            pdf.ln(2)
            continue
        elif line.startswith("# "):
            if not first_h1:
                pdf.ln(3)
            pdf.heading(line[2:], 16)
            first_h1 = False
        elif line.startswith("## ") or line.startswith("### "):
            pdf.ln(2)
            pdf.heading(line.lstrip("#").strip(), 12, accent=False)
            pdf.ln(1)
        elif re.match(r"^\s*[-*]\s+", line):
            pdf.set_x(pdf.l_margin + 3)
            pdf.set_font("Roboto", "", 10)
            pdf.cell(4, 5, "•")
            pdf.multi_cell(0, 5, clean(re.sub(r"^\s*[-*]\s+", "", line)), markdown=True, align="L",
                           new_x="LMARGIN", new_y="NEXT")
        elif re.match(r"^\s*\d+[.)]\s+", line):
            num = re.match(r"^\s*(\d+)", line).group(1)
            pdf.set_x(pdf.l_margin + 3)
            pdf.set_font("Roboto", "", 10)
            pdf.cell(6, 5, f"{num}.")
            pdf.multi_cell(0, 5, clean(re.sub(r"^\s*\d+[.)]\s+", "", line)), markdown=True, align="L",
                           new_x="LMARGIN", new_y="NEXT")
        else:
            pdf.text_block(line.replace("  ", " "), size=10)
        i += 1
    return bytes(pdf.output())


def dunning_pdf(*, title: str, inv: dict[str, Any], customer: dict[str, Any], profile: dict[str, Any],
                branding: dict[str, Any], logo: Path, text: str, rows: list[tuple[str, float]], total: float,
                due_text: str, closing: str = "") -> bytes:
    """Zahlungserinnerung/Mahnung im Corporate Design mit Aufstellung und QR-Code über den Gesamtbetrag."""
    pdf = BrandPDF(branding, profile, logo, f"{title} – Rechnung {inv['number']}")
    pdf.alias_nb_pages()
    pdf.add_page()
    _recipient(pdf, customer, inv.get("customer_name", ""))
    pdf.heading(title)
    pdf.text_block(f"zu Rechnung {inv['number']} vom {_d(inv['date'])}   ·   Datum: {date.today().strftime('%d.%m.%Y')}",
                   size=9, color="anthracite")
    pdf.ln(4)
    for para in text.strip().split("\n\n"):
        pdf.text_block(para, size=10)
        pdf.ln(2)
    pdf.ln(2)
    pdf.set_draw_color(220, 228, 230)
    for label, value in rows:
        pdf.set_font("Roboto", "", 9.5)
        pdf.set_x(20)
        pdf.cell(140, 7, clean(label))
        pdf.cell(30, 7, ("− " if value < 0 else "") + _eur(abs(value)), align="R", new_x="LMARGIN", new_y="NEXT")
        pdf.line(20, pdf.get_y(), 190, pdf.get_y())
    pdf.set_draw_color(*pdf.color("brand"))
    pdf.set_line_width(0.6)
    pdf.line(20, pdf.get_y() + 0.5, 190, pdf.get_y() + 0.5)
    pdf.set_line_width(0.2)
    pdf.set_font("Roboto", "B", 11)
    pdf.set_x(20)
    pdf.cell(140, 8, "Offener Gesamtbetrag")
    pdf.cell(30, 8, _eur(total), align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)
    pay = f"Bitte überweisen Sie {_eur(total)} {due_text}"
    if profile.get("iban"):
        pay += f" auf {profile.get('bank') or 'unser Konto'}, IBAN {profile['iban']}"
        if profile.get("bic"):
            pay += f", BIC {profile['bic']}"
    pay += f". Verwendungszweck: {inv['number']}. Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, " \
           "betrachten Sie es bitte als gegenstandslos."
    _payment_block(pdf, profile, pay, payment_qr(profile, total, f"Rechnung {inv['number']}"))
    pdf.ln(2)
    pdf.text_block(closing or f"Freundliche Grüße\n{profile.get('name') or ''}", size=10)
    return bytes(pdf.output())
