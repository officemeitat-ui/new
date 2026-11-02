# Neuer PC für Offline-KI und eigenes Training: Empfehlung

> Stand: November 2026. GPU- und vor allem RAM-Preise schwanken 2026 stark (KI-Nachfrage).
> Alle Preise sind grobe Richtwerte inkl. USt. **Vor dem Kauf aktuelle Händlerpreise vergleichen.**

## Brauchst du das? Ja, wenn …

- du **Kundendaten mit KI verarbeiten** willst (Tickets, Verträge, Dokumente). Mit lokaler KI verlässt
  nichts das Haus, das ist DSGVO-seitig der sauberste Weg.
- du die **„Private KI-Box“ als Produkt** verkaufen willst. Dann brauchst du eine eigene
  Entwicklungs- und Demo-Maschine.
- du ein **eigenes Modell trainieren** willst (LoRA-Feintuning auf deinen Tickets).

Für reines Ausprobieren reicht ein vorhandener PC mit einer 12–16-GB-Grafikkarte und `qwen3:8b`.

---

## Die drei sinnvollen Varianten

### Variante A: Workstation mit RTX 5090 ⭐ Empfehlung für ME-IT

Schnellste Variante für Modelle bis ~32B, **Training (QLoRA) bis ~32B**, CUDA-Ökosystem, auch Bild-KI.

| Komponente | Empfehlung | Hinweis |
|---|---|---|
| GPU | **NVIDIA GeForce RTX 5090, 32 GB** | Das Herzstück. VRAM ist der wichtigste Wert. |
| CPU | AMD Ryzen 9 9900X / 9950X | Viele Kerne für Datenaufbereitung |
| RAM | **128 GB DDR5** (Minimum 64 GB) | Beim Training und für große Modelle mit CPU-Offload wichtig |
| SSD | 2× NVMe: 1 TB System + 4 TB für Modelle/Daten | Modelle sind 5–70 GB groß |
| Netzteil | 1200–1300 W, ATX 3.1, 80+ Platinum, nativer 12V-2x6-Anschluss | Die 5090 zieht bis ~575 W |
| Gehäuse/Kühlung | Großes Airflow-Gehäuse, gute Lüfter | Läuft beim Training stundenlang unter Volllast |
| System | Windows 11 Pro + **WSL2 (Ubuntu 24.04)** oder direkt Ubuntu | Training unter Linux/WSL2 am problemlosesten |

**Richtpreis: ca. 5.000–7.500 €** (die RTX 5090 allein liegt je nach Marktlage deutlich über 2.000 €).

- ✅ Sehr schnell: ein 14B-Modell antwortet nahezu in Echtzeit, auch für mehrere Benutzer
- ✅ Feintuning von 7–32B-Modellen mit Unsloth/QLoRA
- ⚠️ 32 GB VRAM reichen für 70B-Modelle nur stark quantisiert oder mit Auslagerung (langsam)
- ⚠️ Stromverbrauch und Abwärme unter Last

### Variante B: NVIDIA DGX Spark (GB10, 128 GB) – große Modelle, kompakt

Mini-Rechner mit 128 GB gemeinsamem Speicher, CUDA, ~170 W. Es gibt ihn auch als Varianten anderer
Hersteller mit GB10-Chip (z. B. von ASUS oder Dell).

**Richtpreis: ca. 4.000–5.000 €** (US-Listenpreis 3.999 $, in Europa mit Steuer und Handel höher).

- ✅ 70B-Modelle und MoE-Modelle bis ~120B laufen lokal
- ✅ Feintuning größerer Modelle möglich, leise und sparsam, ideal als Dauer-Server
- ⚠️ Antwortet bei kleinen Modellen deutlich langsamer als eine RTX 5090 (geringere Speicherbandbreite)
- ⚠️ ARM + Linux (DGX OS), kein normaler Windows-Arbeitsplatz

### Variante C: AMD Ryzen AI Max+ 395 (Strix Halo, 128 GB) – Budget-Server

Mini-PCs (z. B. Framework Desktop, GMKtec EVO-X2, HP Z2 Mini) mit 128 GB gemeinsamem Speicher.

**Richtpreis: ca. 2.000–3.100 €.**

- ✅ Günstigster Weg, große Modelle (70B, gpt-oss-120b) überhaupt lokal zu betreiben
- ✅ Leise und sparsam: **gute Hardware für die „Private KI-Box“ beim Kunden**
- ⚠️ Langsamer bei langen Eingaben, Training nur eingeschränkt (ROCm statt CUDA)

### Profi-Option
**RTX PRO 6000 Blackwell (96 GB)** in einer Workstation: ca. 12.000–15.000 €. Das lohnt sich erst, wenn
du KI-Services für viele Kunden gleichzeitig betreibst.

> **Meine Empfehlung:** **Variante A** als dein Entwicklungs-, Trainings- und Demo-PC. Für Kunden-KI-Boxen
> später **Variante C** (günstig, leise) bzw. **B**, wenn der Kunde große Modelle braucht.
> Ein Mac Studio ist für Inferenz ebenfalls gut, für Training und CUDA-Werkzeuge aber die schlechtere Wahl.

---

## Wie viel Speicher braucht welches Modell?

Faustregel: **4-bit-quantisiert ≈ 0,6 GB pro Milliarde Parameter + 1–4 GB für den Kontext.**

| Modellgröße | Inferenz (Q4) | QLoRA-Training | Läuft auf |
|---|---|---|---|
| 7–8B | ~6 GB | ~10–12 GB | fast jede aktuelle GPU |
| 14B | ~10 GB | ~16–20 GB | RTX 5080/5090, alle 128-GB-Systeme |
| 27–32B | ~20 GB | ~26–32 GB | RTX 5090, DGX Spark, Strix Halo |
| 70B | ~42 GB | ~48 GB+ | DGX Spark, Strix Halo (langsam), RTX PRO 6000 |

---

## Welches Modell wofür? (Ollama)

Die Modelllandschaft ändert sich alle paar Monate. Prüfe Tag-Namen auf ollama.com/library und
**teste mit echten deutschen Tickets**, bevor du dich festlegst.

| Aufgabe | Startempfehlung | Alternative |
|---|---|---|
| Agenten, Triage, Angebote (Deutsch) | `qwen3:14b` (RTX 5090: `qwen3:32b`) | Mistral Small, Gemma (Gemma 4 seit 2026 unter Apache 2.0), gpt-oss:20b |
| Schwache Hardware / sehr schnell | `qwen3:8b` | kleinere Gemma-Modelle |
| Semantische Suche (Embeddings) | `bge-m3` (mehrsprachig) | `nomic-embed-text` |
| Eigenes Modell | `meit-assistent` (nach Training, siehe unten) | – |

Auf Lizenzen achten: Qwen, Mistral und Gemma 4 sind Apache 2.0. Andere Modelle (z. B. Llama) haben
eigene Bedingungen für kommerzielle Nutzung.

---

## Einrichtung Schritt für Schritt (Windows 11)

1. **NVIDIA-Treiber** (Studio oder Game Ready, aktuell) installieren
2. **Ollama** installieren: https://ollama.com/download
3. Modelle laden (PowerShell):
   ```powershell
   ollama pull qwen3:14b
   ollama pull bge-m3
   ```
4. **ME-IT Cockpit** starten: `start.ps1` ausführen und http://localhost:8080 öffnen
5. Links unten sollte „Offline-KI aktiv“ stehen. Dann unter *Wissen* auf „Neu indexieren“ klicken.

### Für das Training: WSL2 einrichten
```powershell
wsl --install -d Ubuntu-24.04
```
In Ubuntu:
```bash
sudo apt update && sudo apt install -y python3-venv git
cd /mnt/c/Pfad/zum/projekt
python3 -m venv .venv-train && source .venv-train/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cu128   # passende CUDA-Version: pytorch.org
pip install -r requirements-training.txt
```

---

## Eigenes Modell trainieren (LoRA/QLoRA)

**Wichtig vorab: RAG schlägt Training bei Fachwissen.** Lösungen, Anleitungen und Kundenspezifika
gehören in die Wissensdatenbank, die das Cockpit automatisch durchsucht. Feintuning lohnt sich für:
- den **Stil** (ME-IT-Tonfall in Kundenantworten),
- das **Format** (immer Kategorie, Priorität, nummerierte Schritte),
- **Einordnung/Klassifizierung** nach deinen Regeln.

### Ablauf
1. Tickets sauber lösen und die **Lösung immer dokumentieren** (das ist die Datenbasis!)
2. Cockpit → *KI-Training* → **Trainingsdaten exportieren** (Namen, E-Mails, Telefonnummern, IBANs
   und öffentliche IPs werden pseudonymisiert. Trotzdem stichprobenartig prüfen.)
3. Daten prüfen: `python training/finetune_lora.py --data training/data.jsonl --dry-run`
4. Trainieren (RTX 5090, 14B-Modell: je nach Datenmenge ca. 15–90 Minuten):
   ```bash
   python training/finetune_lora.py --data training/data.jsonl
   # schwächere GPU: --base unsloth/Qwen3-8B-unsloth-bnb-4bit
   ```
5. In Ollama importieren und aktivieren:
   ```bash
   ollama create meit-assistent -f training/output/Modelfile
   ```
   In `.env`: `OLLAMA_MODEL=meit-assistent`
6. **Vergleichen:** dieselben 20 Test-Tickets mit Basis- und eigenem Modell triagieren und nur
   übernehmen, wenn es wirklich besser ist.

### Datenschutz & AI Act
- Nur pseudonymisierte Daten trainieren, Trainingsdaten nicht weitergeben
- Agenten machen **Vorschläge**, Menschen entscheiden. Das Agenten-Protokoll in den Einstellungen dokumentiert jeden Lauf.
- Mitarbeiter in sicherer KI-Nutzung schulen (Art. 4 AI Act)

---

## Quellen (Auswahl)

- Notebookcheck: [DGX Spark gegen Ryzen AI Max+ 395 im Vergleich](https://www.notebookcheck.com/Nvidia-DGX-Spark-gegen-AMD-Ryzen-AI-Max-395-Kompakte-KI-Workstations-im-Vegleich.1232293.0.html)
- Codersera: [Local LLM Hardware Showdown, Juni 2026](https://codersera.com/blog/local-llm-hardware-showdown-june-2026/amp/)
- Context Studios: [Local AI Hardware Guide 2026](https://www.contextstudios.ai/de/blog/local-ai-hardware-guide-2026.md)
- Toolhalla: [Best hardware for local LLMs 2026](https://toolhalla.ai/blog/best-hardware-for-local-llms-2026)
- Layer3 Labs: [Best local LLMs (Aug. 2026)](https://www.layer3labs.io/guides/best-local-llms)
- Unsloth-Dokumentation: docs.unsloth.ai · Ollama-Modellbibliothek: ollama.com/library
