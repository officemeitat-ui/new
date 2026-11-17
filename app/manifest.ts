import type { MetadataRoute } from "next";
import { workspace } from "@/config/workspace";

// Macht den Arbeitsplatz installierbar: am Handy „Zum Home-Bildschirm“, am PC in Edge/Chrome „App installieren“.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `Arbeitsplatz – ${workspace.company}`,
    short_name: "Arbeitsplatz",
    description: "Aufgaben, Tickets, Kunden und KI-Assistent an einem Ort",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#4f46e5",
    lang: "de",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Assistent", url: "/app/assistent", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Aufgaben", url: "/app/aufgaben", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Tickets", url: "/app/tickets", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
