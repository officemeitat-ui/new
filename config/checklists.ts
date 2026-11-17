// Checklisten-Vorlagen für wiederkehrende Abläufe. Je Kunde wird daraus eine Checkliste zum Abhaken (wer, wann).
// Eigene Vorlagen einfach ergänzen – Abschnitte gliedern lange Listen.

export type ChecklistTemplate = {
  id: string;
  title: string;
  description: string;
  /** Platzhalter im Titel, z. B. Name der Person */
  askFor?: string;
  sections: { title: string; items: (string | { text: string; hint: string })[] }[];
};

export const CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
  {
    id: "onboarding",
    title: "Neue/r Mitarbeiter/in",
    description: "Alles vom Konto bis zur Schulung – damit am ersten Tag alles funktioniert.",
    askFor: "Name der neuen Person",
    sections: [
      {
        title: "Vorbereitung",
        items: [
          {
            text: "Identität und Freigabe durch Ansprechpartner/in bestätigt",
            hint: "Rückruf über hinterlegte Nummer – nicht auf Zuruf per Mail",
          },
          "Startdatum, Abteilung, Vorgesetzte/r, Gerätebedarf geklärt",
          "Hardware bestellt bzw. aus Lager zugeteilt (Inventar aktualisieren)",
        ],
      },
      {
        title: "Microsoft 365",
        items: [
          "Benutzerkonto angelegt (Namensschema beachten)",
          "Lizenz zugewiesen",
          "Gruppen, Teams und SharePoint-Berechtigungen nach Rolle",
          "Postfach: Signatur, freigegebene Postfächer, Verteiler",
          { text: "MFA-Registrierung vorbereitet (Temporary Access Pass)", hint: "Kein Standardpasswort per E-Mail verschicken" },
        ],
      },
      {
        title: "Arbeitsplatz",
        items: [
          "Gerät eingerichtet bzw. per Autopilot/Intune ausgerollt",
          "Atera-Agent installiert und Gerät dem Kunden zugeordnet",
          "Drucker, Netzlaufwerke, Branchensoftware eingerichtet",
          "BitLocker aktiv, Wiederherstellungsschlüssel gesichert",
          "Zugänge in Keeper angelegt bzw. geteilt",
        ],
      },
      {
        title: "Abschluss",
        items: [
          "Einweisung am ersten Tag (Anmeldung, MFA, Teams, Drucken)",
          "Security-Awareness-Schulung zugewiesen",
          "Doku aktualisiert (Ansprechpartner, Inventar)",
        ],
      },
    ],
  },
  {
    id: "offboarding",
    title: "Austritt Mitarbeiter/in",
    description: "Zugänge sicher entziehen, Daten übergeben, Geräte zurück.",
    askFor: "Name der austretenden Person",
    sections: [
      {
        title: "Am letzten Tag",
        items: [
          { text: "Austritt durch Geschäftsführung bestätigt", hint: "Schriftlich, mit Datum und Uhrzeit" },
          "Anmeldung in M365 gesperrt, alle Sitzungen beendet",
          "Passwort zurückgesetzt, MFA-Methoden entfernt",
          "VPN, Fernzugriff, Branchensoftware und Drittanbieter-Konten deaktiviert",
          "Geteilte Passwörter in Keeper geändert",
        ],
      },
      {
        title: "Daten",
        items: [
          "Postfach in freigegebenes Postfach umgewandelt bzw. Weiterleitung/Abwesenheitsnotiz",
          "OneDrive-Daten an Vorgesetzte/n übergeben",
          "Lizenz entfernt (Kosten!)",
        ],
      },
      {
        title: "Geräte",
        items: [
          "Notebook, Handy, Token, Schlüssel zurück",
          "Gerät zurückgesetzt bzw. neu zugeteilt (Inventar)",
          "Aus Atera entfernt bzw. umbenannt",
          "Doku aktualisiert (Ansprechpartner)",
        ],
      },
    ],
  },
  {
    id: "pc",
    title: "Neuer Arbeitsplatz-PC",
    description: "Vom Auspacken bis zur Übergabe.",
    askFor: "Gerätename",
    sections: [
      {
        title: "Einrichtung",
        items: [
          "Seriennummer und Garantie im Inventar erfasst",
          "Windows aktualisiert, Treiber/BIOS aktuell",
          "In Domäne/Entra ID aufgenommen, Intune-Richtlinien angekommen",
          "Atera-Agent und Virenschutz/EDR aktiv",
          "BitLocker aktiv, Schlüssel gesichert",
          "Office, Branchensoftware, Drucker",
        ],
      },
      {
        title: "Übergabe",
        items: [
          "Daten vom Altgerät übernommen",
          "Altgerät gelöscht bzw. ausgemustert (Inventar)",
          "Unterschrift bzw. Übergabe dokumentiert",
        ],
      },
    ],
  },
  {
    id: "wartung",
    title: "Jahreswartung Server & Netzwerk",
    description: "Einmal im Jahr: prüfen, testen, dokumentieren – Grundlage für den Wartungsbericht.",
    sections: [
      {
        title: "Server",
        items: [
          "Updates und Firmware (Server, iLO/iDRAC, NAS)",
          "Ereignisanzeige und Speicherplatz geprüft",
          "RAID-/Festplattenstatus, USV-Batterietest",
          { text: "Wiederherstellung aus dem Backup getestet", hint: "Datum unter Backup → letzter Test eintragen" },
        ],
      },
      {
        title: "Netzwerk",
        items: [
          "Firewall-Firmware und Regeln geprüft (alte Freigaben entfernt)",
          "Switch/AP-Firmware aktuell (UniFi/Aruba)",
          "Netzplan mit Realität abgeglichen",
          "WLAN-Kennwort Gastnetz gewechselt",
        ],
      },
      {
        title: "Sicherheit",
        items: [
          "Admin-Konten überprüft (keine Altkonten)",
          "M365: MFA, Conditional Access, Weiterleitungen nach außen",
          "Domain-Prüfung (SPF/DMARC/DKIM) grün",
          "Lizenzen und Verträge geprüft (Fristen)",
          "Selbstbewertung Awareness aktualisiert",
        ],
      },
    ],
  },
  {
    id: "neukunde",
    title: "Neukunde übernehmen",
    description: "Bestandsaufnahme in den ersten zwei Wochen – danach ist die Doku vollständig.",
    sections: [
      {
        title: "Zugänge",
        items: [
          "Admin-Zugänge vom Vor-Dienstleister übernommen und geändert (Keeper)",
          "Microsoft-365-Partnerzugriff (GDAP) eingerichtet",
          "Registrar- und DNS-Zugang geklärt",
          "Atera-Agent auf allen Geräten",
        ],
      },
      {
        title: "Dokumentation",
        items: [
          "Ansprechpartner und Freigabeberechtigte",
          "Standorte, Technikraum, Zutritt",
          "Netzplan, VLANs, WLAN, Patchschrank",
          "Inventar mit Garantien",
          "Domains, M365, Lizenzen, Verträge (Kündigungsfristen!)",
          "Datensicherung inkl. Wiederherstellungstest",
        ],
      },
      { title: "Start", items: ["Selbstbewertung mit der Geschäftsführung", "Maßnahmenplan und Angebot", "Awareness-Schulung für alle"] },
    ],
  },
  {
    id: "m365-grundschutz",
    title: "Microsoft-365-Grundschutz",
    description: "Die wichtigsten Einstellungen für einen sicheren Mandanten.",
    sections: [
      {
        title: "Identitäten",
        items: [
          "MFA für alle (am besten Authenticator mit Nummernabgleich oder Passkey)",
          "Legacy-Authentifizierung blockiert",
          "Zwei Notfallkonten (Break-Glass), von Conditional Access ausgenommen, überwacht",
          "Admin-Rollen nur für eigene Admin-Konten",
          "App-Zustimmung durch Benutzer gesperrt",
        ],
      },
      {
        title: "E-Mail",
        items: [
          "SPF, DKIM, DMARC (mindestens quarantine)",
          "Externe Weiterleitung blockiert",
          "Kennzeichnung externer E-Mails",
          "Defender: Safe Links/Attachments",
        ],
      },
      { title: "Daten", items: ["Externe Freigaben eingeschränkt", "M365-Backup eingerichtet", "Überwachungsprotokoll (Audit) aktiv"] },
    ],
  },
];

export const findTemplate = (id: string) => CHECKLIST_TEMPLATES.find((t) => t.id === id) ?? null;
