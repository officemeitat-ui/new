"""Corporate Design (ME-IT): Logo, Farben, Schrift – für Cockpit, Portal, Formular, Rechnungen, PDFs, E-Mails.

Standardwerte stammen von www.meit.at bzw. dem ME-IT-Logo und sind unter Einstellungen änderbar.
Logo, Icon und Schriften liegen unter /brand/ (öffentlich, damit Portal und Formular sie laden können).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .db import Database

STATIC = Path(__file__).parent / "static"
DEFAULT_BRANDING = {
    "tagline": "sicher | innovativ | persönlich",
    "website": "https://www.meit.at",
    "brand": "#00bcd4",      # Cyan („ME“)
    "brand_2": "#00ced4",    # Türkis (Power-Ring)
    "primary": "#00838f",    # Buttons/Links (gut lesbar)
    "accent": "#f79007",     # Orange
    "dark": "#17252a",
    "anthracite": "#5a5656",  # „-IT“
}
COLOR_KEYS = ("brand", "brand_2", "primary", "accent", "dark", "anthracite")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
FONT_FILES = {"Roboto-Regular.woff2", "Roboto-Medium.woff2", "Roboto-Bold.woff2", "Roboto-Regular.ttf",
              "Roboto-Medium.ttf", "Roboto-Bold.ttf"}
IMAGE_TYPES = {b"\x89PNG": ("png", "image/png"), b"\xff\xd8\xff": ("jpg", "image/jpeg"), b"RIFF": ("webp", "image/webp")}


def get_branding(db: Database, company: str = "ME-IT") -> dict[str, Any]:
    return {"name": company, **DEFAULT_BRANDING, **(db.get_setting("branding", {}) or {})}


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    v = value.lstrip("#")
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def logo_path(data_dir: Path) -> Path:
    for ext in ("png", "jpg", "webp"):
        custom = data_dir / "brand" / f"logo.{ext}"
        if custom.exists():
            return custom
    return STATIC / "brand" / "logo.png"


class BrandingIn(BaseModel):
    tagline: Optional[str] = Field(None, max_length=120)
    website: Optional[str] = Field(None, max_length=200)
    colors: dict[str, str] = {}


def register(app: FastAPI, db: Database, company: str, data_dir: Path, admin_only) -> None:
    cache = {"Cache-Control": "public, max-age=86400"}

    @app.get("/brand/logo", include_in_schema=False)
    def logo() -> FileResponse:
        return FileResponse(logo_path(data_dir), headers={"Cache-Control": "public, max-age=300"})

    @app.get("/brand/icon.png", include_in_schema=False)
    def icon() -> FileResponse:
        return FileResponse(STATIC / "brand" / "icon.png", headers=cache)

    @app.get("/brand/fonts/{name}", include_in_schema=False)
    def font(name: str) -> FileResponse:
        if name not in FONT_FILES:
            raise HTTPException(404, "Nicht gefunden")
        return FileResponse(STATIC / "fonts" / name, headers=cache)

    @app.get("/api/public/branding")
    def public_branding() -> dict:
        return {**get_branding(db, company), "logo_url": "/brand/logo"}

    @app.put("/api/branding", dependencies=[Depends(admin_only)])
    def set_branding(data: BrandingIn) -> dict:
        stored = db.get_setting("branding", {}) or {}
        for key, value in data.colors.items():
            if key not in COLOR_KEYS or not HEX.match(value or ""):
                raise HTTPException(422, f"Ungültige Farbe für {key} (Format #rrggbb)")
            stored[key] = value.lower()
        if data.tagline is not None:
            stored["tagline"] = data.tagline.strip()
        if data.website is not None:
            stored["website"] = data.website.strip()
        db.set_setting("branding", stored)
        return public_branding()

    @app.post("/api/branding/reset", dependencies=[Depends(admin_only)])
    def reset_branding() -> dict:
        db.set_setting("branding", {})
        for ext in ("png", "jpg", "webp"):
            (data_dir / "brand" / f"logo.{ext}").unlink(missing_ok=True)
        return public_branding()

    @app.put("/api/branding/logo", dependencies=[Depends(admin_only)])
    async def upload_logo(request: Request) -> dict:
        body = await request.body()
        if not body or len(body) > 2 * 1024 * 1024:
            raise HTTPException(413 if body else 422, "Logo als PNG, JPG oder WebP, max. 2 MB.")
        kind = next((v for magic, v in IMAGE_TYPES.items() if body.startswith(magic)), None)
        if not kind or (kind[0] == "webp" and body[8:12] != b"WEBP"):
            raise HTTPException(415, "Nur PNG, JPG oder WebP (kein SVG – Sicherheitsgründe).")
        target = data_dir / "brand"
        target.mkdir(parents=True, exist_ok=True)
        for ext in ("png", "jpg", "webp"):
            (target / f"logo.{ext}").unlink(missing_ok=True)
        (target / f"logo.{kind[0]}").write_bytes(body)
        return public_branding()
