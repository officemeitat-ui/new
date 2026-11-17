"""Sprachnotizen: Audio → Text, lokal mit Whisper (faster-whisper). Keine Cloud.

Installation (einmalig, am KI-PC):  pip install -r requirements-voice.txt
Beim ersten Aufruf wird das Modell (Standard „small“, ca. 0,5 GB) einmalig heruntergeladen,
danach läuft alles offline. Mit NVIDIA-GPU deutlich schneller (WHISPER_DEVICE=cuda).
Die Audiodatei wird nach der Umwandlung sofort gelöscht (Datensparsamkeit).
"""

from __future__ import annotations

import os
import threading
from typing import Any

_model: Any = None
_lock = threading.Lock()


class SpeechUnavailable(RuntimeError):
    pass


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return False
    return True


def _get_model() -> Any:
    global _model
    with _lock:
        if _model is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise SpeechUnavailable(
                    "Spracherkennung nicht installiert: pip install -r requirements-voice.txt") from exc
            _model = WhisperModel(os.environ.get("WHISPER_MODEL", "small"),
                                  device=os.environ.get("WHISPER_DEVICE", "auto"), compute_type="default")
        return _model


def transcribe(path: str, language: str = "de") -> str:
    model = _get_model()
    segments, _info = model.transcribe(path, language=language, vad_filter=True)
    return " ".join(seg.text.strip() for seg in segments).strip()
