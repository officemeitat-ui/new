# ME-IT Cockpit als Windows-Dienst einrichten (startet automatisch mit Windows)
# Voraussetzungen: Python 3.11+, NSSM (https://nssm.cc) im PATH oder neben diesem Skript.
# Ausführen in einer Administrator-PowerShell im Projektordner:
#   powershell -ExecutionPolicy Bypass -File .\deploy\install-windows-service.ps1
$ErrorActionPreference = "Stop"
$Name = "MEIT-Cockpit"
$Root = Split-Path -Parent $PSScriptRoot

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Bitte PowerShell als Administrator starten."
}
$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm -and (Test-Path "$PSScriptRoot\nssm.exe")) { $nssm = "$PSScriptRoot\nssm.exe" }
if (-not $nssm) { throw "NSSM nicht gefunden. Von https://nssm.cc laden und nssm.exe in den Ordner 'deploy' legen." }

Set-Location $Root
if (-not (Test-Path ".venv")) { py -3 -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install -q -r requirements.txt
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
New-Item -ItemType Directory -Force -Path "$Root\data\logs" | Out-Null

& $nssm stop $Name 2>$null | Out-Null
& $nssm remove $Name confirm 2>$null | Out-Null
& $nssm install $Name "$Root\.venv\Scripts\python.exe" "-m meit"
& $nssm set $Name AppDirectory $Root
& $nssm set $Name DisplayName "ME-IT Cockpit"
& $nssm set $Name Description "ME-IT Cockpit mit lokalen KI-Agenten"
& $nssm set $Name Start SERVICE_AUTO_START
& $nssm set $Name AppStdout "$Root\data\logs\meit.log"
& $nssm set $Name AppStderr "$Root\data\logs\meit.log"
& $nssm set $Name AppRotateFiles 1
& $nssm set $Name AppRotateBytes 10485760
& $nssm start $Name
Write-Host "Fertig. Das Cockpit läuft als Dienst '$Name' auf http://localhost:8080"
Write-Host "Neu starten nach Änderungen an .env:  nssm restart $Name"
