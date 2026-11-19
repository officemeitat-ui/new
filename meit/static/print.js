"use strict";
// Druck-Knopf der Rechnungsansicht (eigene Datei, damit die Seite ohne eingebettetes Skript auskommt)
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("print-btn");
  if (btn) btn.addEventListener("click", () => window.print());
});
