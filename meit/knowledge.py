"""Wissensdatenbank-Suche (RAG): Hybrid aus semantischer Suche und Stichworten.

* Mit Ollama + Embedding-Modell (Standard ``bge-m3``, mehrsprachig) wird semantisch
  gesucht – "Drucker druckt nicht" findet auch "Druckwarteschlange hängt".
* Ohne KI funktioniert eine BM25-artige Stichwortsuche – die App bleibt nutzbar.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
import re
from collections import Counter
from typing import Any

from .db import Database, loads

STOPWORDS = set(
    """
    der die das den dem des ein eine einer eines einem einen und oder aber nicht kein keine ist sind war
    wird werden wurde hat haben habe ich du er sie es wir ihr mit von zu zum zur im in am an auf aus bei
    für fuer über ueber unter nach vor seit bis als wie was wer wo wann warum dass da so auch noch nur
    schon sehr mehr mal bitte danke hallo kann können koennen geht gehen funktioniert seit heute mein
    meine unser unsere man sich wenn dann denn doch ja nein alle alles immer wieder
    niemand jemand gibt macht machen muss muessen soll sollte will wollen moechte
    beim vom ins ohne sowie dabei damit daher dazu hier dort jetzt gerade leider gestern frueh ganz etwas
    viel viele wenig keinen keiner dringend danke gruss gruesse liebe sehr geehrte herr frau
    hilfe frage fragen anfrage problem probleme
    the a an and or is are to of for on in with it this that not
    """.split()
)


def normalize(text: str) -> str:
    text = (text or "").lower()
    for src, dst in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(src, dst)
    return text


def tokenize(text: str) -> list[str]:
    tokens = re.findall(r"[a-z0-9][a-z0-9\-\.]{1,}", normalize(text))
    return [t.strip(".-") for t in tokens if t not in STOPWORDS and len(t.strip(".-")) > 1]


SYNONYM_GROUPS = [
    "passwort kennwort password", "mail e-mail email", "pc computer rechner", "laptop notebook", "handy smartphone mobiltelefon",
    "bildschirm monitor display", "wlan wifi wi-fi", "drucker printer", "langsam traege lahm", "kaputt defekt", "loeschen entfernen",
    "anmelden einloggen login anmeldung", "sicherung backup datensicherung", "virus schadsoftware malware trojaner",
    "mfa 2fa zwei-faktor authenticator", "besprechung meeting konferenz", "ordner verzeichnis", "gesperrt blockiert",
    "abwesenheitsnotiz abwesenheit urlaubsnotiz", "update aktualisierung", "absturz crash",
    "kamera webcam", "ton sound audio", "internet online", "telefon telefonie", "papierkorb geloescht",
]
SYNONYMS: dict[str, set[str]] = {}
for _group in SYNONYM_GROUPS:
    _words = _group.split()
    for _w in _words:
        SYNONYMS.setdefault(_w, set()).update(x for x in _words if x != _w)


def related(a: str, b: str) -> bool:
    """Wortformen erkennen: „drucker“ ~ „druckertreiber“ (Präfix) und „sendet“ ~ „senden“ (gleicher Wortstamm)."""
    if len(a) < 4 or len(b) < 4 or a[:4] != b[:4]:
        return False
    if a.startswith(b) or b.startswith(a):
        return True
    shorter = min(len(a), len(b))
    common = 4
    while common < shorter and a[common] == b[common]:
        common += 1
    return common >= max(5, shorter - 1)


@lru_cache(maxsize=8192)
def _counts(text: str) -> tuple[dict[str, int], int]:
    """Wörter eines Artikels zählen – je Text nur einmal, danach aus dem Zwischenspeicher."""
    counts = Counter(tokenize(text))
    return dict(counts), sum(counts.values())


def keyword_scores(query: str, docs: list[str]) -> list[float]:
    """Einfaches BM25 mit Wortformen und Synonymen („Kennwort“ findet auch „Passwort“)."""
    return _score(query, docs)[0]


def _score(query: str, docs: list[str]) -> tuple[list[float], list[set[str]]]:
    """Punkte je Text – und welche Wörter der Anfrage darin vorkommen (Synonyme zählen als das gesuchte Wort)."""
    base = set(tokenize(query))
    if not base or not docs:
        return [0.0] * len(docs), [set() for _ in docs]
    weights: dict[str, tuple[float, str]] = {q: (1.0, q) for q in base}
    for q in base:
        for syn in SYNONYMS.get(q, ()):
            weights.setdefault(syn, (0.6, q))
    counted = [_counts(d) for d in docs]
    counts, lengths = [c for c, _ in counted], [n for _, n in counted]
    avg_len = sum(lengths) / len(docs) or 1.0
    n_docs = len(docs)
    vocabulary: dict[str, set[str]] = {}  # alle Wörter der Texte, nach den ersten vier Buchstaben abgelegt
    for c in counts:
        for token in c:
            if len(token) >= 4:
                vocabulary.setdefault(token[:4], set()).add(token)
    k1, b = 1.4, 0.75
    scores = [0.0] * n_docs
    matched: list[set[str]] = [set() for _ in docs]
    for q, (weight, origin) in weights.items():  # auch bei langen Ticket-Texten und einigen hundert Artikeln schnell
        forms = [t for t in vocabulary.get(q[:4], ()) if t != q and related(t, q)] if len(q) >= 4 else []
        tfs = [c.get(q, 0) + 0.5 * sum(c.get(t, 0) for t in forms) if forms else float(c.get(q, 0)) for c in counts]
        df = sum(1 for tf in tfs if tf)
        if not df:
            continue
        idf = math.log(1 + (n_docs - df + 0.5) / (df + 0.5))
        for i, tf in enumerate(tfs):
            if tf:
                scores[i] += weight * idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * lengths[i] / avg_len))
                matched[i].add(origin)
    return scores, matched


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def article_text(article: dict[str, Any]) -> str:
    return f"{article.get('title', '')}\n{article.get('area') or ''} {article.get('tags', '')}\n{article.get('content', '')}"


class KnowledgeBase:
    def __init__(self, db: Database, router):
        self.db = db
        self.router = router

    def ensure_embeddings(self, limit: int = 0) -> int:
        """Berechnet fehlende/veraltete Embeddings (höchstens ``limit``, 0 = alle). Gibt Anzahl neu berechneter zurück."""
        model = self.router.settings.embed_model
        rows = self.db.query(
            "SELECT id, title, area, tags, content FROM kb_articles WHERE embedding = '' OR embedding_model != ?"
            + (" LIMIT ?" if limit else ""), (model, limit) if limit else (model,))
        done = 0
        for start in range(0, len(rows), 24):  # in Päckchen: eine große Bibliothek überfordert sonst die lokale KI
            batch = rows[start:start + 24]
            vectors = self.router.embed([article_text(r)[:4000] for r in batch])
            if not vectors:
                break
            for row, vec in zip(batch, vectors):
                self.db.query("UPDATE kb_articles SET embedding = ?, embedding_model = ? WHERE id = ?", (json.dumps(vec), model, row["id"]))
            done += len(batch)
        return done

    def suggest(self, title: str, text: str = "", limit: int = 4) -> list[dict[str, Any]]:
        """Passende Anleitungen zu einem Vorgang: Der Titel entscheidet, die Beschreibung verfeinert nur.

        Bewusst streng – lieber keine Empfehlung als eine, die nur wegen eines Allerweltsworts auftaucht. Eine Anleitung
        zählt, wenn ihre Überschrift oder ihre Schlagworte zwei Wörter des Titels enthalten – oder eines, das in der
        Bibliothek selten und damit aussagekräftig ist („BitLocker“, „NAS“, „Kassa“). Nennt der Titel überhaupt nur ein
        Thema, genügt dieses."""
        articles = self.db.query("SELECT id, title, area, tags, content, public, source, updated_at FROM kb_articles")
        if not articles or not title.strip():
            return []
        body = [f"{a.get('title', '')}\n{a.get('tags') or ''}\n{a.get('content', '')}" for a in articles]
        head = [f"{a.get('title', '')} {a.get('tags') or ''}" for a in articles]
        body_score, in_body = _score(title, body)
        head_score, in_head = _score(title, head)
        spread = Counter(word for words in in_body for word in words)
        rare = {word for word, n in spread.items() if n <= max(3, 0.06 * len(articles))}
        extra = keyword_scores(f"{title} {text[:800]}", body) if text.strip() else [0.0] * len(articles)
        need = 2 if len(spread) >= 2 else 1  # nennt der Titel nur ein Thema („Internet geht nicht“), genügt dieses eine Wort
        scored = [(body_score[i] + 1.5 * head_score[i] + 0.35 * extra[i], len(in_head[i]) >= need, a) for i, a in enumerate(articles)
                  if len(in_head[i]) >= need or in_head[i] & rare]
        if not scored:
            return []
        if not any(strong for _, strong, _ in scored):
            limit = min(limit, 2)  # nur ein einzelnes seltenes Wort trägt die Empfehlung – dann zurückhaltend bleiben
        best = max(s for s, _, _ in scored)
        scored = sorted((x for x in scored if x[0] >= 0.5 * best), key=lambda x: -x[0])[:limit]
        return [{**a, "score": round(s, 1)} for s, _, a in scored]

    def search(self, query: str, limit: int = 5, public_only: bool = False) -> list[dict[str, Any]]:
        articles = self.db.query("SELECT * FROM kb_articles" + (" WHERE public = 1" if public_only else ""))
        if not articles or not query.strip():
            return []
        kw = keyword_scores(query, [article_text(a) for a in articles])
        # Treffer in Titel und Schlagworten zählen deutlich mehr als ein beiläufiges Wort im Text
        head = keyword_scores(query, [f"{a.get('title', '')} {a.get('tags') or ''}" for a in articles])
        kw = [k + 1.5 * h for k, h in zip(kw, head)]
        max_kw = max(kw) or 1.0
        semantic: list[float] | None = None
        try:
            self.ensure_embeddings(limit=24)  # bei einer Suche nur ein Päckchen nachziehen; alles auf einmal: „Neu indexieren“
            q_vec = self.router.embed([query])
        except Exception:  # noqa: BLE001 - Suche darf nie an der KI scheitern
            q_vec = None
        if q_vec:
            model = self.router.settings.embed_model
            fresh = self.db.query("SELECT id, embedding, embedding_model FROM kb_articles")
            emb = {r["id"]: loads(r["embedding"], []) for r in fresh if r["embedding_model"] == model}
            semantic = [cosine(q_vec[0], emb.get(a["id"], [])) for a in articles]

        results = []
        for i, article in enumerate(articles):
            kw_norm = kw[i] / max_kw
            if semantic is not None:
                score = 0.65 * max(semantic[i], 0) + 0.35 * kw_norm
                relevant = semantic[i] > 0.45 or kw[i] > 0
            else:
                score = kw_norm
                relevant = kw[i] > 0
            if relevant:
                results.append(
                    {
                        "id": article["id"],
                        "title": article["title"],
                        "tags": article["tags"],
                        "content": article["content"],
                        "public": article.get("public", 0),
                        "score": round(score, 3),
                        "mode": "semantisch+stichwort" if semantic is not None else "stichwort",
                    }
                )
        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:limit]

    def similar_tickets(self, text: str, exclude_id: int | None = None, limit: int = 3) -> list[dict[str, Any]]:
        """Ähnliche, bereits gelöste Tickets – die beste Quelle für Lösungsvorschläge."""
        rows = self.db.query(
            "SELECT id, title, description, solution, category FROM tickets "
            "WHERE status = 'geloest' AND solution != ''"
        )
        rows = [r for r in rows if r["id"] != exclude_id]
        if not rows:
            return []
        scores = keyword_scores(text, [f"{r['title']} {r['description']} {r['category']}" for r in rows])
        ranked = sorted(zip(scores, rows), key=lambda x: x[0], reverse=True)
        return [dict(r, score=round(s, 3)) for s, r in ranked[:limit] if s > 0]
