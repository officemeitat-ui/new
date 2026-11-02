#!/usr/bin/env bash
# ME-IT Cockpit starten (Linux/macOS/WSL)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Erster Start: virtuelle Umgebung wird angelegt …"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt

[ -f .env ] || cp .env.example .env

if command -v ollama >/dev/null 2>&1; then
  echo "Ollama gefunden. Modelle laden (falls noch nicht vorhanden) …"
  model=$(grep -E '^OLLAMA_MODEL=' .env | cut -d= -f2 || true)
  ollama pull "${model:-qwen3:14b}" || true
  ollama pull bge-m3 || true
else
  echo "Hinweis: Ollama nicht installiert – die App läuft ohne KI (Regeln/Stichwortsuche)."
  echo "         Installation: https://ollama.com/download"
fi

exec python -m meit
