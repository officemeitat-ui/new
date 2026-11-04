"""Generates packages/domain/src/agent-templates.ts from prompts/02_AGENTEN_BIBLIOTHEK.md."""
import json, re, sys
src = sys.argv[1] if len(sys.argv) > 1 else "prompts/02_AGENTEN_BIBLIOTHEK.md"
out = sys.argv[2] if len(sys.argv) > 2 else "packages/domain/src/agent-templates.ts"
md = open(src, encoding="utf-8").read()

META = {
  1: ("posteingang", "balanced", "low", ["wissen_suchen:auto", "email_senden:approve"], ["email", "crm"]),
  2: ("angebote", "smart", "medium", ["wissen_suchen:auto", "rechner:auto", "email_senden:approve"], ["crm", "documents"]),
  3: ("kundenservice", "balanced", "low", ["wissen_suchen:auto"], ["calendar", "channels"]),
  4: ("termine", "balanced", "medium", ["aktuelle_zeit:auto", "email_senden:approve"], ["calendar"]),
  5: ("belegpruefer", "balanced", "medium", ["rechner:auto", "email_senden:approve"], ["email", "accounting", "files"]),
  6: ("mahnwesen", "balanced", "low", ["rechner:auto", "aktuelle_zeit:auto", "email_senden:approve"], ["accounting"]),
  7: ("protokoll", "balanced", "medium", ["aktuelle_zeit:auto", "email_senden:approve"], ["tasks", "meetings"]),
  8: ("firmenwissen", "balanced", "low", ["wissen_suchen:auto"], []),
  9: ("vertraege", "smart", "high", ["wissen_suchen:auto", "aktuelle_zeit:auto", "rechner:auto"], ["calendar", "tasks"]),
  10: ("leads", "balanced", "medium", ["email_senden:approve"], ["crm", "web"]),
  11: ("it-support", "balanced", "medium", ["wissen_suchen:auto", "geraete_suchen:auto", "geraet_details:auto", "geraet_synchronisieren:auto", "geraet_neu_starten:approve", "geraet_sperren:approve"], ["mdm", "tickets", "monitoring"]),
  12: ("chef-assistent", "smart", "medium", ["aktuelle_zeit:auto"], ["email", "calendar", "tasks", "delegation"]),
  13: ("reinigung-kalkulation", "smart", "medium", ["reinigung_kalkulieren:auto", "wissen_suchen:auto", "email_senden:approve"], ["documents"]),
  14: ("reklamationen", "balanced", "low", ["meldungen_abfragen:auto", "wissen_suchen:auto", "email_senden:approve"], ["email"]),
  15: ("ausschreibungen", "smart", "high", ["wissen_suchen:auto", "reinigung_kalkulieren:auto", "aktuelle_zeit:auto"], ["documents"]),
}
INDUSTRIES = {
  "handwerk": [1, 2, 3, 4, 6, 12], "steuerberatung": [1, 5, 7, 8, 9], "immobilien": [1, 3, 4, 7, 9],
  "handel": [1, 3, 5, 10], "agenturen": [2, 7, 10, 12], "industrie": [2, 5, 8, 9, 11], "it": [11],
  "gebaeudereinigung": [1, 4, 8, 13, 14, 15],
}

# ROI from the summary table: "| 1   | Posteingangs-Manager | Ausgewogen / low | 4 Min. pro E-Mail |"
roi = {}
for m in re.finditer(r"^\|\s*(\d+)\s*\|[^|]*\|[^|]*\|\s*(\d+) Min\. (pro [^|]+?)\s*\|", md, re.M):
    roi[int(m.group(1))] = (int(m.group(2)), m.group(3).strip())

sections = re.split(r"^### (\d+) · (.+)$", md, flags=re.M)
templates = []
for i in range(1, len(sections), 3):
    num, title, body = int(sections[i]), sections[i + 1].strip(), sections[i + 2]
    if num not in META:
        continue
    slug, tier, effort, tools, integrations = META[num]
    def row(label):
        m = re.search(r"^\|\s*\*\*" + label + r"\*\*\s*\|\s*(.+?)\s*\|\s*$", body, re.M)
        return m.group(1).strip() if m else ""
    prompt = re.search(r"```text\n(.*?)\n```", body, re.S).group(1).strip()
    tests = re.search(r"\*\*Kern-Testfälle\*\*\n\n(.*?)(?:\n\n---|\Z)", body, re.S)
    test_cases = [re.sub(r"^\d+\.\s*", "", line).replace("_", "").strip() for line in tests.group(1).split("\n") if line.strip()] if tests else []
    variables = {}
    var_row = row("Variablen")
    for m in re.finditer(r"`([a-z_.]+)`(?:\s*\(Standard:?\s*([^)]*)\))?", var_row):
        variables[m.group(1)] = (m.group(2) or "").strip() or None
    # Variables used in the prompt but not listed (e.g. firma.name, agent.tonalitaet)
    for name in re.findall(r"\{\{([a-z_.]+)\}\}", prompt):
        variables.setdefault(name, None)
    variables.pop("firma.name", None)
    templates.append({
        "id": slug, "number": num, "name": title,
        "purpose": row("Zweck"), "trigger": row("Auslöser"),
        "tier": tier, "effort": effort,
        "roiMinutesPerTask": roi[num][0], "roiUnit": roi[num][1],
        "instructions": prompt,
        "tools": [{"name": t.split(":")[0], "mode": t.split(":")[1]} for t in tools],
        "requiredIntegrations": integrations,
        "variables": [{"name": k, "default": v} for k, v in variables.items()],
        "industries": [k for k, nums in INDUSTRIES.items() if num in nums],
        "testCases": test_cases,
    })

assert len(templates) == 15, len(templates)
body = json.dumps(templates, ensure_ascii=False, indent=2)
open(out, "w", encoding="utf-8").write(f'''// GENERATED from prompts/02_AGENTEN_BIBLIOTHEK.md – do not edit by hand.
// Regenerate: python3 scripts/gen-agent-templates.py
import type {{ ToolMode }} from "@nexus/db/schema";

export type AgentTemplate = {{
  id: string;
  number: number;
  name: string;
  purpose: string;
  trigger: string;
  tier: "smart" | "balanced" | "fast";
  effort: "low" | "medium" | "high";
  roiMinutesPerTask: number;
  roiUnit: string;
  /** System prompt of the agent; {{{{variables}}}} are filled in per tenant. */
  instructions: string;
  /** Platform tools the template uses, with their default approval mode. */
  tools: {{ name: string; mode: ToolMode }}[];
  /** Integrations the template needs for its full job (shown as "braucht …"). */
  requiredIntegrations: string[];
  variables: {{ name: string; default: string | null }}[];
  industries: string[];
  testCases: string[];
}};

export const AGENT_TEMPLATES: readonly AgentTemplate[] = {body} as AgentTemplate[];

export const INDUSTRIES = {json.dumps(list(INDUSTRIES.keys()))} as const;
''')
print("ok", len(templates), sum(len(t["variables"]) for t in templates), "variables")
for t in templates:
    print(t["number"], t["id"], t["roiMinutesPerTask"], t["roiUnit"], [v["name"] + ("=" + v["default"] if v["default"] else "") for v in t["variables"]][:6], len(t["testCases"]))
