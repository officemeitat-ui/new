"use client";

import { useEffect } from "react";

const STORAGE_KEY = "tracking_source";
const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "li_fat_id"];

/**
 * Merkt sich Kampagnen-Parameter und externen Referrer beim ersten Seitenaufruf der Sitzung,
 * damit sie auch dann beim Lead landen, wenn erst über weitere Seiten zum Funnel navigiert wird.
 */
export function TrackingCapture() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY)) return;
      const params = new URLSearchParams(window.location.search);
      const source: Record<string, string> = {};
      for (const key of TRACKING_PARAMS) {
        const value = params.get(key);
        if (value) source[key] = value.slice(0, 200);
      }
      if (document.referrer && !document.referrer.startsWith(window.location.origin)) {
        source.referrer = document.referrer.slice(0, 200);
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(source));
    } catch {
      // Speicher nicht verfügbar (z. B. privater Modus) – Tracking ist optional.
    }
  }, []);
  return null;
}

export function readTrackingSource(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}
