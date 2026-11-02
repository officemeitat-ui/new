"""Agenten-Logik mit simulierter KI (FakeLLM) – prüft Werkzeug-Schleife und Validierung."""


def test_assistant_uses_tools_then_answers(client, use_fake_llm):
    fake = use_fake_llm([
        {"tool": "kunde_finden", "args": {"name": "Huber"}},
        {"tool": "ticket_anlegen", "args": {"customer_id": 1, "title": "Bildschirm flackert", "priority": "normal"}},
        {"final": "Ticket für die Tischlerei Huber wurde angelegt."},
    ])
    r = client.post("/api/agents/assistant", json={"messages": [
        {"role": "user", "content": "Leg für Huber ein Ticket an: Bildschirm flackert"}]}).json()
    assert r["answer"] == "Ticket für die Tischlerei Huber wurde angelegt."
    assert [s["tool"] for s in r["steps"]] == ["kunde_finden", "ticket_anlegen"]
    assert r["steps"][0]["result"][0]["name"] == "Tischlerei Huber GmbH"
    assert r["steps"][1]["result"]["ok"] is True
    # Werkzeug-Ergebnisse werden ans Modell zurückgegeben
    assert "Ergebnis von kunde_finden" in fake.calls[1]["messages"][-1]["content"]
    tickets = client.get("/api/tickets?customer_id=1").json()
    assert any(t["title"] == "Bildschirm flackert" for t in tickets)


def test_assistant_handles_unknown_tool_and_fenced_json(client, use_fake_llm):
    use_fake_llm([
        '```json\n{"tool": "gibt_es_nicht", "args": {}}\n```',
        'Hier meine Antwort: {"final": "Fertig."}',
    ])
    r = client.post("/api/agents/assistant", json={"messages": [{"role": "user", "content": "Test"}]}).json()
    assert r["answer"] == "Fertig."
    assert "Unbekanntes Werkzeug" in r["steps"][0]["result"]["fehler"]


def test_triage_with_ai_is_validated(client, use_fake_llm):
    use_fake_llm([{
        "kategorie": "netzwerk", "prioritaet": "HOCH", "zusammenfassung": "WLAN in der Lobby fällt aus",
        "loesungsschritte": ["AP neu starten", "Kanal prüfen"], "antwort_an_kunden": "Wir kümmern uns.",
        "geschaetzte_minuten": 40, "verkaufschance": "WLAN-Modernisierung",
    }])
    t = client.post("/api/tickets", json={"customer_id": 5, "title": "WLAN weg", "description": "Lobby"}).json()
    s = t["ai_suggestion"]
    assert t["category"] == "Netzwerk" and t["priority"] == "hoch"
    assert s["steps"] == ["AP neu starten", "Kanal prüfen"]
    assert s["provider"] == "fake:fake-model"
    assert s["hint"] == "WLAN-Modernisierung"


def test_triage_falls_back_on_garbage(client, use_fake_llm):
    use_fake_llm(["kein json", "immer noch kein json"])
    t = client.post("/api/tickets", json={"customer_id": 1, "title": "Drucker druckt nicht"}).json()
    assert t["category"] == "Hardware"
    assert "error" in t["ai_suggestion"]


def test_quote_ai_codes_are_validated_and_totals_computed(client, use_fake_llm):
    use_fake_llm([{
        "titel": "Sicherheit für Steiner", "einleitung": "Danke für das Gespräch.",
        "positionen": [
            {"code": "SEC", "menge": 65, "begruendung": "EDR für alle"},
            {"code": "ERFUNDEN", "menge": 3},
            {"code": "SEC", "menge": 1},
            {"code": "NIS2GAP", "menge": "abc"},
        ],
        "hinweise": "Annahme: 65 Arbeitsplätze",
    }])
    q = client.post("/api/agents/quote", json={"customer_id": 3, "need": "Security und NIS2"}).json()
    assert [i["code"] for i in q["items"]] == ["SEC", "NIS2GAP"]
    sec = q["items"][0]
    assert sec["quantity"] == 65 and sec["total"] == round(65 * sec["price"], 2)
    assert q["total_monthly"] == sec["total"]
    assert q["total_once"] == q["items"][1]["total"]
    assert q["title"] == "Sicherheit für Steiner"


def test_report_and_security_use_ai_text(client, use_fake_llm):
    use_fake_llm(["Ihre IT lief stabil.", "Ihr Risiko ist mittel."])
    r = client.post("/api/agents/report", json={"customer_id": 2}).json()
    assert "Ihre IT lief stabil." in r["text"]
    s = client.post("/api/security/assess", json={"customer_id": 2, "answers": {"mfa": "ja"}}).json()
    assert "Ihr Risiko ist mittel." in s["report"]
    log = client.get("/api/agents/log").json()
    assert {e["agent"] for e in log} >= {"bericht", "security"}
