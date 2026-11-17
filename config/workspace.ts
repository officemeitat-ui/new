// Arbeitsplatz des IT-Dienstleisters selbst: Aufgaben, Kunden, Tickets (Atera), Kalender und KI-Assistent.
// Platzhalter – vor dem Einsatz an den eigenen Betrieb anpassen.

export type WorkspaceProfile = {
  /** Vorname, mit dem der Assistent dich anspricht. */
  ownerName: string;
  company: string;
  timeZone: string;
  /** Aufgabenlisten wie in Microsoft To Do; die erste ist die Standardliste. */
  lists: string[];
  /** Dauer eines Termins, wenn keine angegeben ist. */
  defaultAppointmentMinutes: number;
  atera: {
    /** Link zu einem Ticket in Atera; {id} wird ersetzt. */
    ticketUrl: string;
    /** Darf der Arbeitsplatz den Ticketstatus in Atera ändern? */
    allowStatusChange: boolean;
  };
  hours: {
    /** Zeitbuchungen auf volle Minuten-Schritte aufrunden (z. B. 15 = angefangene Viertelstunde); 0 = minutengenau. */
    roundToMinutes: number;
    /** Ab diesem Reststand (Minuten) wird das Stundenkonto als knapp markiert. */
    lowBalanceMinutes: number;
  };
  keeper: {
    /** Tresor-Adresse für den Knopf „In Keeper öffnen“, wenn beim Kunden kein eigener Link hinterlegt ist. */
    vaultUrl: string;
  };
  placeholder: boolean;
};

export const workspace: WorkspaceProfile = {
  ownerName: "Max",
  company: "IT Muster e.U.",
  timeZone: "Europe/Vienna",
  lists: ["Allgemein", "Kunden", "Projekte", "Büro"],
  defaultAppointmentMinutes: 60,
  atera: {
    ticketUrl: "https://app.atera.com/new/ticket/{id}",
    allowStatusChange: true,
  },
  hours: {
    roundToMinutes: 0,
    lowBalanceMinutes: 120,
  },
  keeper: {
    vaultUrl: "https://keepersecurity.eu/vault/",
  },
  placeholder: true,
};
