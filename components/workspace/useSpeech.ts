"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Spracheingabe über die Web Speech API des Browsers (Chrome, Edge, Safari). Ohne Unterstützung bleibt der Knopf ausgeblendet –
// am Handy funktioniert dann immer noch das Diktieren über die Tastatur.

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

function createRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Constructor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Constructor ? new Constructor() : null;
}

/** Diktieren: liefert laufend den erkannten Text und ruft onFinal mit dem fertigen Satz auf. */
export function useSpeech(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const callback = useRef(onFinal);
  useEffect(() => {
    callback.current = onFinal;
  }, [onFinal]);

  useEffect(() => {
    setSupported(createRecognition() !== null);
  }, []);

  const start = useCallback(() => {
    const r = createRecognition();
    if (!r) return;
    finalText.current = "";
    setInterim("");
    setError(null);
    r.lang = "de-AT";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      setInterim(text);
      if (event.results[event.results.length - 1]?.isFinal) finalText.current = text;
    };
    r.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(event.error === "not-allowed" ? "Mikrofon nicht freigegeben" : "Spracheingabe nicht verfügbar");
      }
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
      const text = finalText.current.trim();
      if (text) callback.current(text);
    };
    recognition.current = r;
    setListening(true);
    r.start();
  }, []);

  const stop = useCallback(() => recognition.current?.stop(), []);

  return { supported, listening, interim, error, start, stop };
}
