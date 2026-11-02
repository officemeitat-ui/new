# ME-IT Cockpit starten (Windows PowerShell)
# Rechtsklick > "Mit PowerShell ausführen" oder:  powershell -ExecutionPolicy Bypass -File .\start.ps1
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if (-not (Test-Path ".venv")) {
    Write-Host "Erster Start: virtuelle Umgebung wird angelegt ..."
    py -3 -m venv .venv
}
& .\.venv\Scripts\Activate.ps1
pip install -q -r requirements.txt

if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }

if (Get-Command ollama -ErrorAction SilentlyContinue) {
    $model = (Select-String -Path ".env" -Pattern "^OLLAMA_MODEL=(.*)$").Matches.Groups[1].Value
    if (-not $model) { $model = "qwen3:14b" }
    Write-Host "Ollama gefunden. Lade Modelle ($model, bge-m3) ..."
    ollama pull $model
    ollama pull bge-m3
} else {
    Write-Host "Hinweis: Ollama nicht installiert - die App laeuft ohne KI. Download: https://ollama.com/download"
}

# Browser nach kurzer Wartezeit öffnen (Server braucht ein paar Sekunden)
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile -Command "Start-Sleep 4; Start-Process http://localhost:8080"'
python -m meit
