"""Wissensdatenbank-Suche (RAG): Hybrid aus semantischer Suche und Stichworten.

* Mit Ollama + Embedding-Modell (Standard ``bge-m3``, mehrsprachig) wird semantisch
  gesucht – "Drucker druckt nicht" findet auch "Druckwarteschlange hängt".
* Ohne KI funktioniert eine BM25-artige Stichwortsuche – die App bleibt nutzbar.
"""

from __future__ import annotations

import json
import math
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


def keyword_scores(query: str, docs: list[str]) -> list[float]:
    """Einfaches BM25 mit Präfix-Treffern (deutsche Komposita: "drucker" ~ "druckertreiber")."""
    q_tokens = tokenize(query)
    if not q_tokens or not docs:
        return [0.0] * len(docs)
    doc_tokens = [tokenize(d) for d in docs]
    avg_len = sum(len(t) for t in doc_tokens) / max(len(doc_tokens), 1) or 1.0
    n_docs = len(docs)
    k1, b = 1.4, 0.75
    scores = []
    for tokens in doc_tokens:
        counts = Counter(tokens)
        score = 0.0
        for q in set(q_tokens):
            tf = counts.get(q, 0) + 0.5 * sum(c for t, c in counts.items() if t != q and (t.startswith(q) or q.startswith(t)) and min(len(t), len(q)) >= 4)
            if tf == 0:
                continue
            df = sum(1 for toks in doc_tokens if any(t == q or ((t.startswith(q) or q.startswith(t)) and min(len(t), len(q)) >= 4) for t in toks))
            idf = math.log(1 + (n_docs - df + 0.5) / (df + 0.5))
            score += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * len(tokens) / avg_len))
        scores.append(score)
    return scores


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def article_text(article: dict[str, Any]) -> str:
    return f"{article.get('title', '')}\n{article.get('tags', '')}\n{article.get('content', '')}"


class KnowledgeBase:
    def __init__(self, db: Database, router):
        self.db = db
        self.router = router

    def ensure_embeddings(self) -> int:
        """Berechnet fehlende/veraltete Embeddings. Gibt Anzahl neu berechneter zurück."""
        model = self.router.settings.embed_model
        rows = self.db.query(
            "SELECT id, title, tags, content FROM kb_articles WHERE embedding = '' OR embedding_model != ?",
            (model,),
        )
        if not rows:
            return 0
        vectors = self.router.embed([article_text(r)[:4000] for r in rows])
        if not vectors:
            return 0
        for row, vec in zip(rows, vectors):
            self.db.update("kb_articles", row["id"], {"embedding": json.dumps(vec), "embedding_model": model})
        return len(rows)

    def search(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        articles = self.db.query("SELECT * FROM kb_articles")
        if not articles or not query.strip():
            return []
        kw = keyword_scores(query, [article_text(a) for a in articles])
        max_kw = max(kw) or 1.0
        semantic: list[float] | None = None
        try:
            self.ensure_embeddings()
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
