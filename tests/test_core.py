from datetime import date

import pytest

from meit.agents.triage import rule_triage
from meit.db import Database
from meit.knowledge import keyword_scores, tokenize
from meit.llm import LLMError, extract_json, strip_think
from meit.radar import Radar, eol_info
from meit.security import QUESTIONS, evaluate
from meit.seed import seed_services


@pytest.mark.parametrize("text,expected", [
    ('{"a": 1}', {"a": 1}),
    ('```json\n{"a": 2}\n```', {"a": 2}),
    ('Klar! {"a": {"b": "x}"}} danke', {"a": {"b": "x}"}}),
    ('<think>{"falsch": 1}</think>{"a": 3}', {"a": 3}),
    ('[1, 2]', [1, 2]),
])
def test_extract_json(text, expected):
    assert extract_json(text) == expected


def test_extract_json_fails_cleanly():
    with pytest.raises(LLMError):
        extract_json("gar nichts")


def test_strip_think():
    assert strip_think("<think>\nlange Überlegung\n</think>\nAntwort") == "Antwort"


def test_tokenize_normalizes_umlauts_and_stopwords():
    assert tokenize("Der Drucker hängt bei Müller") == ["drucker", "haengt", "mueller"]


def test_keyword_scores_prefers_relevant_doc():
    scores = keyword_scores("outlook startet nicht", ["Drucker Warteschlange", "Outlook Profil reparieren"])
    assert scores[1] > scores[0] == 0


@pytest.mark.parametrize("os_name,label", [
    ("Windows 10 Pro 22H2", "Windows 10"),
    ("Microsoft Windows Server 2012 R2 Standard", "Windows Server 2012/R2"),
    ("Windows Server 2016", "Windows Server 2016"),
])
def test_eol_info(os_name, label):
    assert eol_info(os_name)[1] == label


def test_eol_info_unknown():
    assert eol_info("Windows 11 Pro") is None
    assert eol_info("") is None


@pytest.mark.parametrize("title,desc,cat,prio", [
    ("Server down", "Produktion steht, niemand kann arbeiten", "Server/Backup", "kritisch"),
    ("Phishing", "Mitarbeiter hat Link geklickt und Daten eingegeben", "Sicherheit", "hoch"),
    ("Outlook", "Postfach synchronisiert nicht", "E-Mail/M365", "normal"),
    ("Frage", "Gibt es eine Möglichkeit für KI ohne Cloud?", "Beratung/Anfrage", "niedrig"),
])
def test_rule_triage(title, desc, cat, prio):
    assert rule_triage(title, desc) == {"category": cat, "priority": prio}


def test_security_evaluate_weights():
    all_no = evaluate({}, employees=10)
    assert all_no["score"] == 0 and all_no["level"] == "kritisch"
    assert len(all_no["gaps"]) == len(QUESTIONS)
    half = evaluate({q["id"]: "teilweise" for q in QUESTIONS}, employees=60)
    assert half["score"] == 50 and half["level"] == "mittel"
    assert "wahrscheinlich" in half["nis2"]


def _radar_db(tmp_path):
    db = Database(str(tmp_path / "r.db"))
    db.init_schema()
    seed_services(db)
    return db


def test_radar_rules(tmp_path):
    db = _radar_db(tmp_path)
    today = date(2026, 11, 2)
    cid = db.insert("customers", {"name": "Fertigung AG", "employees": 80, "industry": "Maschinenbau",
                                  "package": "keins", "contract_end": "", "booked_services": "[]"})
    db.insert("assets", {"customer_id": cid, "name": "SRV1", "type": "server", "os": "Windows Server 2012 R2"})
    db.insert("assets", {"customer_id": cid, "name": "SRV2", "type": "server", "os": "Windows Server 2016"})
    db.insert("assets", {"customer_id": cid, "name": "PC1", "type": "pc", "os": "Windows 10 Pro"})
    db.insert("assets", {"customer_id": cid, "name": "PC2", "type": "notebook", "os": "Windows 10 Pro"})
    db.insert("assets", {"customer_id": cid, "name": "PC3", "type": "pc", "os": "Windows 11",
                         "purchase_date": "2019-01-01", "warranty_end": "2022-01-01"})
    scan = Radar(db).scan(today=today)
    titles = [o["title"] for o in scan["opportunities"]]
    assert "Auf Managed-Services-Vertrag umstellen" in titles
    assert any("Windows Server 2012" in t for t in titles)
    assert any("Windows Server 2016-Ablöse planen" in t for t in titles)
    win10 = [o for o in scan["opportunities"] if o["title"].startswith("Windows 10-Migration")]
    assert len(win10) == 1 and "(2 Geräte)" in win10[0]["title"]  # PC + Notebook zusammengefasst
    assert any(o["title"].startswith("Hardware-Erneuerung") for o in scan["opportunities"])
    assert any(o["kind"] == "compliance" and o["priority"] == 3 for o in scan["opportunities"])
    managed = next(o for o in scan["opportunities"] if o["kind"] == "managed")
    assert managed["monthly"] == 80 * 39
    assert scan["total_annual"] == round(sum(o["annual_value"] for o in scan["opportunities"]), 2)


def test_radar_respects_booked_services(tmp_path):
    db = _radar_db(tmp_path)
    cid = db.insert("customers", {"name": "Gut versorgt", "employees": 12, "package": "premium",
                                  "booked_services": '["MW","SEC","BCK","AWR","KIWS"]'})
    kinds = {o["service_code"] for o in Radar(db).scan(cid)["opportunities"]}
    assert not kinds & {"SEC", "BCK", "AWR", "KIWS", "MW"}


def test_radar_ki_word_boundary(tmp_path):
    db = _radar_db(tmp_path)
    cid = db.insert("customers", {"name": "Hotel Kitzbühel", "employees": 3, "industry": "Tourismus",
                                  "notes": "Kinderhotel", "booked_services": "[]"})
    assert not any(o["service_code"] == "KIBOX" for o in Radar(db).scan(cid)["opportunities"])
    db.update("customers", cid, {"notes": "Chef fragt nach KI für Buchungen"})
    assert any(o["service_code"] == "KIBOX" for o in Radar(db).scan(cid)["opportunities"])
