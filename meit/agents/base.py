"""Gemeinsame Bausteine der Agenten: Kontext, Protokollierung, Werkzeug-Schleife.

Die Werkzeug-Schleife nutzt ein einfaches JSON-Protokoll statt provider-spezifischem
"Function Calling" – dadurch funktioniert sie mit kleinen lokalen Modellen (Ollama),
LM Studio und Claude gleichermaßen.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from ..db import Database
from ..knowledge import KnowledgeBase
from ..llm import LLM, LLMError, Router
from ..radar import Radar


@dataclass
class AgentContext:
    db: Database
    router: Router
    kb: KnowledgeBase
    radar: Radar
    company: str = "ME-IT"
    settings: Any = None  # meit.config.Settings
    mailer: Any = None    # meit.mail.Mailer
    docs: Any = None      # meit.documents.DocumentService

    def llm(self) -> LLM:
        return self.router.get()

    def log(self, agent: str, provider: str, input_data: Any, output: Any, ok: bool, started: float) -> None:
        def short(v: Any) -> str:
            text = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
            return text[:4000]

        self.db.insert("agent_log", {
            "agent": agent, "provider": provider, "input": short(input_data), "output": short(output),
            "ok": ok, "duration_ms": int((time.time() - started) * 1000),
        })


@dataclass
class Tool:
    name: str
    description: str
    params: dict[str, str]
    func: Callable[..., Any]


@dataclass
class ToolAgent:
    llm: LLM
    system: str
    tools: list[Tool]
    max_steps: int = 6
    steps: list[dict[str, Any]] = field(default_factory=list)

    def _protocol(self) -> str:
        tool_lines = []
        for t in self.tools:
            params = ", ".join(f'"{k}": {v}' for k, v in t.params.items()) or "keine"
            tool_lines.append(f"- {t.name}: {t.description} Parameter: {params}")
        return (
            f"{self.system}\n\n"
            "Du kannst folgende Werkzeuge nutzen, um echte Daten abzufragen oder Aktionen auszuführen:\n"
            + "\n".join(tool_lines)
            + "\n\nAntworte IMMER mit genau EINEM JSON-Objekt und sonst nichts:\n"
            '- Werkzeug aufrufen: {"tool": "<name>", "args": {...}}\n'
            '- Endgültige Antwort an den Benutzer: {"final": "<Antwort auf Deutsch, Markdown erlaubt>"}\n'
            "Erfinde keine Daten – nutze Werkzeuge. Wenn ein Werkzeug nichts findet, sag das ehrlich."
        )

    def _call(self, name: str, args: dict[str, Any]) -> Any:
        tool = next((t for t in self.tools if t.name == name), None)
        if tool is None:
            return {"fehler": f"Unbekanntes Werkzeug '{name}'. Verfügbar: {[t.name for t in self.tools]}"}
        try:
            clean = {k: v for k, v in (args or {}).items() if k in tool.params}
            return tool.func(**clean)
        except Exception as exc:  # noqa: BLE001 - Fehler gehen als Ergebnis zurück ans Modell
            return {"fehler": str(exc)}

    def run(self, messages: list[dict[str, str]]) -> str:
        system = self._protocol()
        convo = list(messages)
        for _ in range(self.max_steps):
            reply = self.llm.chat_json(convo, system=system)
            if isinstance(reply, dict) and reply.get("final"):
                return str(reply["final"])
            if isinstance(reply, dict) and reply.get("tool"):
                name = str(reply["tool"])
                args = reply.get("args") if isinstance(reply.get("args"), dict) else {}
                result = self._call(name, args)
                self.steps.append({"tool": name, "args": args, "result": result})
                result_text = json.dumps(result, ensure_ascii=False, default=str)[:6000]
                convo.append({"role": "assistant", "content": json.dumps(reply, ensure_ascii=False)})
                convo.append({"role": "user", "content": f"Ergebnis von {name}:\n{result_text}"})
                continue
            # Modell hat ein anderes Format geliefert – als Antwort interpretieren.
            if isinstance(reply, dict):
                text = next((str(v) for v in reply.values() if isinstance(v, str) and len(v) > 20), "")
                if text:
                    return text
            raise LLMError("Unerwartetes Antwortformat des Modells.")
        convo.append({"role": "user", "content": 'Formuliere jetzt die endgültige Antwort als {"final": "..."}.'})
        reply = self.llm.chat_json(convo, system=system)
        if isinstance(reply, dict) and reply.get("final"):
            return str(reply["final"])
        raise LLMError("Agent hat keine Antwort gefunden.")
