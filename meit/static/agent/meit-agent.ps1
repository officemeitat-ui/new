#Requires -Version 5.1
<#
.SYNOPSIS
    ME-IT Inventar-Agent - meldet den Zustand dieses Geraets an das ME-IT Cockpit. NUR LESEND.

.DESCRIPTION
    Der Agent liest Angaben zu Hardware, Windows, Verschluesselung, Virenschutz, Firewall, Updates,
    Speicherplatz, lokalen Administratoren und installierter Software und sendet sie per HTTPS an das Cockpit.
    Er aendert nichts am System, fuehrt keine Befehle vom Server aus und laedt keine Programme nach.
    Die Antwort des Servers wird nur auf "ok" geprueft.

    Installation (als Administrator, z. B. ueber Atera/Intune/GPO verteilen):
        powershell -ExecutionPolicy Bypass -File meit-agent.ps1 -Install -Server "https://portal.firma.at" -Key "meit-..."
    Anzeigen, was gesendet wuerde (sendet nichts):
        powershell -ExecutionPolicy Bypass -File meit-agent.ps1 -ShowOnly
    Entfernen:
        powershell -ExecutionPolicy Bypass -File "C:\ProgramData\ME-IT\Agent\meit-agent.ps1" -Uninstall
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Run,
    [switch]$ShowOnly,
    [switch]$AllowHttp,
    [string]$Server = "",
    [string]$Key = "",
    [int]$IntervalHours = 6
)

$ErrorActionPreference = "Stop"
$AgentVersion = "1.0.0"
$AgentDir = Join-Path $env:ProgramData "ME-IT\Agent"
$ConfigFile = Join-Path $AgentDir "agent.json"
$LogFile = Join-Path $AgentDir "agent.log"
$TaskName = "ME-IT Inventar-Agent"

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

function Write-Log {
    param([string]$Text)
    $line = "{0}  {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Text
    Write-Host $line
    try {
        if (Test-Path $AgentDir) {
            if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 200KB)) { Remove-Item $LogFile -Force }
            Add-Content -Path $LogFile -Value $line -Encoding UTF8
        }
    } catch { }
}

function Get-Safe {
    # Fuehrt einen Leseblock aus; bei Fehlern (fehlendes Modul, keine Rechte) wird der Standardwert geliefert.
    param([scriptblock]$Block, $Default = $null)
    try { return (& $Block) } catch { return $Default }
}

function Format-Date {
    param($Value)
    if ($null -eq $Value) { return "" }
    try { return ([datetime]$Value).ToString("s") } catch { return "" }
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Inventory {
    $cs = Get-Safe { Get-CimInstance Win32_ComputerSystem }
    $os = Get-Safe { Get-CimInstance Win32_OperatingSystem }
    $bios = Get-Safe { Get-CimInstance Win32_BIOS }
    $enclosure = Get-Safe { Get-CimInstance Win32_SystemEnclosure | Select-Object -First 1 }
    $cpu = Get-Safe { (Get-CimInstance Win32_Processor | Select-Object -First 1).Name } ""

    $model = [string](Get-Safe { $cs.Model } "")
    $isServer = [bool](Get-Safe { $os.ProductType -ne 1 } $false)
    $chassis = "desktop"
    $laptopTypes = @(8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32)
    if ($model -match "Virtual|VMware|KVM|HVM|Xen|VirtualBox|Parallels") { $chassis = "vm" }
    elseif ($isServer) { $chassis = "server" }
    elseif (Get-Safe { @($enclosure.ChassisTypes | Where-Object { $laptopTypes -contains $_ }).Count -gt 0 } $false) { $chassis = "laptop" }

    $disks = @(Get-Safe {
        Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
            [ordered]@{
                drive   = [string]$_.DeviceID
                size_gb = [math]::Round($_.Size / 1GB, 1)
                free_gb = [math]::Round($_.FreeSpace / 1GB, 1)
            }
        }
    } @())

    # --- Verschluesselung (BitLocker) des Systemlaufwerks
    $blState = "unknown"
    $blMethod = ""
    $blVolume = Get-Safe { Get-BitLockerVolume -MountPoint $env:SystemDrive }
    if ($null -ne $blVolume) {
        $protection = [string]$blVolume.ProtectionStatus
        if ($protection -eq "On") { $blState = "on" } elseif ($protection -eq "Off") { $blState = "off" }
        $blMethod = [string]$blVolume.EncryptionMethod
    } else {
        $wmiVolume = Get-Safe {
            Get-CimInstance -Namespace "root\CIMV2\Security\MicrosoftVolumeEncryption" -ClassName Win32_EncryptableVolume |
                Where-Object { $_.DriveLetter -eq $env:SystemDrive } | Select-Object -First 1
        }
        if ($null -ne $wmiVolume) {
            if ($wmiVolume.ProtectionStatus -eq 1) { $blState = "on" } elseif ($wmiVolume.ProtectionStatus -eq 0) { $blState = "off" }
        }
    }

    # --- TPM und Secure Boot
    $tpm = Get-Safe { Get-CimInstance -Namespace "root\cimv2\Security\MicrosoftTpm" -ClassName Win32_Tpm }
    $tpmPresent = $null
    $tpmVersion = ""
    if ($null -ne $tpm) {
        $tpmPresent = $true
        $tpmVersion = ([string]$tpm.SpecVersion).Split(",")[0].Trim()
    } elseif (Test-IsAdmin) {
        $tpmPresent = $false
    }
    $secureBoot = Get-Safe { [bool](Confirm-SecureBootUEFI) }

    # --- Virenschutz
    $antivirus = @(Get-Safe {
        Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName AntiVirusProduct | ForEach-Object {
            $state = [int]$_.productState
            [ordered]@{
                name       = [string]$_.displayName
                enabled    = (($state -band 0x1000) -ne 0)
                up_to_date = (($state -band 0x10) -eq 0)
            }
        }
    } @())
    $mp = Get-Safe { Get-MpComputerStatus }
    $defender = [ordered]@{ realtime = $null; signature_age_days = $null; tamper = $null }
    if ($null -ne $mp) {
        $defender.realtime = [bool]$mp.RealTimeProtectionEnabled
        $defender.signature_age_days = [int]$mp.AntivirusSignatureAge
        $defender.tamper = [bool]$mp.IsTamperProtected
    }

    # --- Firewall
    $firewall = [ordered]@{ domain = $null; private = $null; public = $null }
    $profiles = Get-Safe { Get-NetFirewallProfile } @()
    foreach ($p in @($profiles)) {
        $name = ([string]$p.Name).ToLower()
        if ($firewall.Contains($name)) { $firewall[$name] = ([string]$p.Enabled -eq "True") }
    }

    # --- Updates
    $lastUpdate = Get-Safe {
        $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
        $count = $searcher.GetTotalHistoryCount()
        if ($count -gt 0) {
            $entries = $searcher.QueryHistory(0, [math]::Min($count, 60))
            ($entries | Where-Object { $_.ResultCode -eq 2 -and $_.Operation -eq 1 } | Sort-Object Date -Descending | Select-Object -First 1).Date
        }
    }
    if ($null -eq $lastUpdate) {
        $lastUpdate = Get-Safe { (Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn }
    }
    $pendingReboot = [bool](
        (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending") -or
        (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired")
    )

    # --- Lokale Administratoren
    $admins = @(Get-Safe { Get-LocalGroupMember -SID "S-1-5-32-544" | ForEach-Object { [string]$_.Name } } @())
    if ($admins.Count -eq 0) {
        $admins = @(Get-Safe {
            $groupName = (New-Object Security.Principal.SecurityIdentifier "S-1-5-32-544").Translate([Security.Principal.NTAccount]).Value.Split("\")[1]
            $group = [ADSI]("WinNT://./" + $groupName + ",group")
            $group.Invoke("Members") | ForEach-Object {
                $path = [string]$_.GetType().InvokeMember("ADsPath", "GetProperty", $null, $_, $null)
                ($path -replace "^WinNT://", "") -replace "/", "\"
            }
        } @())
    }

    $rdp = Get-Safe { ((Get-ItemProperty "HKLM:\System\CurrentControlSet\Control\Terminal Server").fDenyTSConnections -eq 0) }

    # --- Installierte Software (nur Name, Version, Hersteller)
    $software = @(Get-Safe {
        $roots = @(
            "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
        )
        $found = foreach ($root in $roots) {
            if (Test-Path $root) {
                foreach ($entry in (Get-ChildItem -Path $root -ErrorAction SilentlyContinue)) {
                    try {
                        $name = [string]$entry.GetValue("DisplayName")
                        if ($name -and -not $entry.GetValue("SystemComponent") -and $name -notmatch "^(Security Update|Update for|Hotfix)") {
                            [pscustomobject]@{
                                name      = $name
                                version   = [string]$entry.GetValue("DisplayVersion")
                                publisher = [string]$entry.GetValue("Publisher")
                            }
                        }
                    } catch { }
                }
            }
        }
        if ($found) { $found | Sort-Object name -Unique | Select-Object -First 400 }
    } @())

    return [ordered]@{
        agent_version = $AgentVersion
        hostname      = [string]$env:COMPUTERNAME
        domain        = [string](Get-Safe { $cs.Domain } "")
        user          = [string](Get-Safe { $cs.UserName } "")
        manufacturer  = [string](Get-Safe { $cs.Manufacturer } "")
        model         = $model
        serial        = [string](Get-Safe { $bios.SerialNumber } "")
        chassis       = $chassis
        cpu           = [string]$cpu
        ram_gb        = (Get-Safe { [math]::Round($cs.TotalPhysicalMemory / 1GB) })
        os            = [ordered]@{
            caption      = [string](Get-Safe { $os.Caption } "")
            version      = [string](Get-Safe { $os.Version } "")
            build        = [string](Get-Safe { $os.BuildNumber } "")
            install_date = (Format-Date (Get-Safe { $os.InstallDate }))
            last_boot    = (Format-Date (Get-Safe { $os.LastBootUpTime }))
            server       = $isServer
        }
        disks         = $disks
        bitlocker     = [ordered]@{ os_drive = $blState; method = $blMethod }
        tpm           = [ordered]@{ present = $tpmPresent; version = $tpmVersion }
        secure_boot   = $secureBoot
        antivirus     = $antivirus
        defender      = $defender
        firewall      = $firewall
        updates       = [ordered]@{ last_installed = (Format-Date $lastUpdate); pending_reboot = $pendingReboot }
        local_admins  = $admins
        rdp_enabled   = $rdp
        software      = $software
        collected_at  = (Get-Date).ToString("s")
    }
}

function Invoke-Cockpit {
    param([string]$BaseUrl, [string]$Path, $Body, [string]$Token = "")
    $json = ConvertTo-Json -InputObject $Body -Depth 6 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $headers = @{ }
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    $uri = $BaseUrl.TrimEnd("/") + $Path
    return Invoke-RestMethod -Method Post -Uri $uri -Body $bytes -ContentType "application/json; charset=utf-8" -Headers $headers -UserAgent "ME-IT-Agent/$AgentVersion" -TimeoutSec 60
}

function Assert-ServerUrl {
    param([string]$Url)
    if (-not $Url) { throw "Parameter -Server fehlt (z. B. https://portal.firma.at)." }
    if ($Url -notmatch "^https://" -and -not $AllowHttp) {
        throw "Nur HTTPS ist erlaubt (-AllowHttp nur fuer Tests im internen Netz)."
    }
}

function Protect-AgentDirectory {
    # Ordner nur fuer SYSTEM und Administratoren lesbar (dort liegt das Geraete-Token).
    New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null
    $acl = Get-Acl -Path $AgentDir
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existing in @($acl.Access)) { [void]$acl.RemoveAccessRule($existing) }
    foreach ($sid in @("S-1-5-18", "S-1-5-32-544")) {
        $identity = New-Object Security.Principal.SecurityIdentifier $sid
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
        $acl.AddAccessRule($rule)
    }
    Set-Acl -Path $AgentDir -AclObject $acl
}

function Send-Checkin {
    if (-not (Test-Path $ConfigFile)) { throw "Agent ist nicht registriert (zuerst mit -Install einrichten)." }
    $config = Get-Content -Path $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.allow_http) { $script:AllowHttp = $true }
    Assert-ServerUrl $config.server
    $inventory = Get-Inventory
    try {
        $answer = Invoke-Cockpit -BaseUrl $config.server -Path "/api/public/agent/checkin" -Body $inventory -Token $config.token
        if ($answer.ok) { Write-Log "Meldung gesendet." } else { Write-Log "Unerwartete Antwort des Cockpits." }
    } catch {
        Write-Log ("Meldung fehlgeschlagen: " + $_.Exception.Message)
        throw
    }
}

# ----------------------------------------------------------------------------- Ablauf
if ($ShowOnly) {
    Get-Inventory | ConvertTo-Json -Depth 6
    return
}

if ($Uninstall) {
    if (-not (Test-IsAdmin)) { throw "Bitte als Administrator ausfuehren." }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $AgentDir) { Remove-Item -Path $AgentDir -Recurse -Force }
    Write-Host "ME-IT Inventar-Agent entfernt."
    return
}

if ($Install) {
    if (-not (Test-IsAdmin)) { throw "Bitte als Administrator ausfuehren." }
    Assert-ServerUrl $Server
    if (-not $Key) { throw "Parameter -Key fehlt (Registrierungsschluessel aus dem Cockpit)." }
    if ($IntervalHours -lt 1) { $IntervalHours = 6 }

    Protect-AgentDirectory
    $target = Join-Path $AgentDir "meit-agent.ps1"
    if ($PSCommandPath -and ((Resolve-Path $PSCommandPath).Path -ne $target)) { Copy-Item -Path $PSCommandPath -Destination $target -Force }

    $serial = [string](Get-Safe { (Get-CimInstance Win32_BIOS).SerialNumber } "")
    $enrollment = Invoke-Cockpit -BaseUrl $Server -Path "/api/public/agent/enroll" -Body @{ key = $Key; hostname = $env:COMPUTERNAME; serial = $serial }
    if (-not $enrollment.token) { throw "Registrierung fehlgeschlagen (keine Antwort mit Token)." }
    $config = [ordered]@{ server = $Server.TrimEnd("/"); token = [string]$enrollment.token; device_id = $enrollment.device_id; allow_http = [bool]$AllowHttp }
    Set-Content -Path $ConfigFile -Value (ConvertTo-Json -InputObject $config) -Encoding UTF8

    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Run' -f $target
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
    $atStartup = New-ScheduledTaskTrigger -AtStartup
    $repeating = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(10) -RepetitionInterval (New-TimeSpan -Hours $IntervalHours)
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atStartup, $repeating) -Principal $principal -Settings $settings -Force | Out-Null

    Write-Log "Agent registriert (Geraet $($enrollment.device_id))."
    Send-Checkin
    Write-Host "ME-IT Inventar-Agent installiert. Meldung alle $IntervalHours Stunden."
    return
}

if ($Run) {
    Send-Checkin
    return
}

Write-Host "ME-IT Inventar-Agent $AgentVersion - Parameter: -Install -Server <URL> -Key <Schluessel> | -Run | -ShowOnly | -Uninstall"
