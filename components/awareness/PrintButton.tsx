"use client";

import { useEffect } from "react";

/** Macht Knöpfe mit data-print zu „Drucken“ (ohne Inline-Skript, CSP-tauglich). */
export function PrintButtons() {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest("[data-print]")) window.print();
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);
  return null;
}
