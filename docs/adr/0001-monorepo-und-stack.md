# ADR 0001 – Monorepo mit pnpm und Turborepo

**Status:** angenommen · **Datum:** 2026-11-03

## Kontext

Die Plattform besteht aus einer Web-App, einem Worker, einem einbettbaren Widget und mehreren Bibliotheken (Datenbank, Agent-Runtime, Konnektoren, Designsystem). Diese Teile teilen Typen und Schemas und ändern sich oft gemeinsam.

## Entscheidung

- Ein Monorepo mit **pnpm Workspaces** und **Turborepo** für Build-Caching und Aufgaben-Reihenfolge.
- **TypeScript** im `strict`-Modus überall, plus `noUncheckedIndexedAccess`.
- Interne Pakete werden **als TypeScript-Quellcode** konsumiert (`exports` zeigt auf `src/`). Next.js transpiliert sie über `transpilePackages`, der Worker läuft mit `tsx`. So gibt es keinen separaten Build-Schritt pro Paket und keine veralteten `dist`-Ordner.
- Tests mit **Vitest**, E2E mit **Playwright**.

## Konsequenzen

- Ein `pnpm install`, ein `pnpm test` für alles.
- Für Produktions-Images des Workers wird mit `tsx` gestartet oder später gebündelt (ADR folgt, falls nötig).
