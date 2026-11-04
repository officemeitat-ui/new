import { z } from "zod";
import { defineTool } from "./tools";

/**
 * Offer calculation for commercial cleaning (Gebäudereinigung), as commonly structured in the
 * trade (WKO-Stundensatzkalkulation, REFA/RAL performance values):
 *
 *   hours per cleaning   = area ÷ performance value (m²/h)
 *   cleanings per year   = cleanings per week × cleaning weeks − cleanings lost to days off
 *   labour cost per hour = wage × (1 + ancillary wage costs)
 *   cost price per hour  = labour cost × (1 + overhead)
 *   billing rate         = cost price × (1 + risk and profit)
 *   price per month      = hours per year ÷ 12 × billing rate + materials
 *
 * All figures (wage, surcharges, performance values, maximum values such as ÖNORM D 2050) come
 * from the company – the tool does not know or invent any.
 */
export type CleaningRoom = {
  bezeichnung: string;
  raumgruppe: string;
  flaeche_m2: number;
  leistungswert_m2_h: number;
  reinigungen_pro_woche: number;
};

export type CleaningInput = {
  raeume: CleaningRoom[];
  reinigungswochen_pro_jahr: number;
  ausfalltage_pro_jahr: number;
  stundenlohn_eur: number;
  lohnnebenkosten_prozent: number;
  gemeinkosten_prozent: number;
  wagnis_gewinn_prozent: number;
  material_eur_pro_monat: number;
  ust_prozent: number;
  hoechstwerte: { raumgruppe: string; max_m2_h: number }[];
};

const money = (value: number) => Math.round(value * 100 + Number.EPSILON) / 100;
const hours = (value: number) => Math.round(value * 100 + Number.EPSILON) / 100;

export function calculateCleaning(input: CleaningInput) {
  const problems: string[] = [];
  if (input.raeume.length === 0) throw new Error("Bitte mindestens einen Raum angeben.");
  if (input.raeume.length > 300) throw new Error("Höchstens 300 Räume pro Kalkulation.");
  if (input.stundenlohn_eur <= 0)
    throw new Error("Bitte den Stundenlohn laut Kollektivvertrag angeben.");
  if (input.reinigungswochen_pro_jahr <= 0 || input.reinigungswochen_pro_jahr > 53) {
    throw new Error("Reinigungswochen pro Jahr: 1 bis 53.");
  }
  for (const percent of [
    input.lohnnebenkosten_prozent,
    input.gemeinkosten_prozent,
    input.wagnis_gewinn_prozent,
    input.ust_prozent,
  ]) {
    if (percent < 0 || percent > 300)
      throw new Error("Prozentwerte müssen zwischen 0 und 300 liegen.");
  }
  const maxima = new Map(
    input.hoechstwerte.map((h) => [h.raumgruppe.trim().toLowerCase(), h.max_m2_h]),
  );

  const rooms = input.raeume.map((room) => {
    if (room.flaeche_m2 <= 0 || room.flaeche_m2 > 1_000_000) {
      throw new Error(`„${room.bezeichnung}“: Fläche muss größer als 0 sein.`);
    }
    if (room.leistungswert_m2_h <= 0) {
      throw new Error(`„${room.bezeichnung}“: Leistungswert muss größer als 0 sein.`);
    }
    if (room.reinigungen_pro_woche < 0 || room.reinigungen_pro_woche > 21) {
      throw new Error(`„${room.bezeichnung}“: 0 bis 21 Reinigungen pro Woche.`);
    }
    const perCleaning = room.flaeche_m2 / room.leistungswert_m2_h;
    // Days off are spread over a five-day week: 11 holidays cost a daily cleaned room 11 cleanings.
    const lost = Math.round(
      (input.ausfalltage_pro_jahr * Math.min(room.reinigungen_pro_woche, 5)) / 5,
    );
    const perYear = Math.max(
      0,
      Math.round(room.reinigungen_pro_woche * input.reinigungswochen_pro_jahr) - lost,
    );
    const max = maxima.get(room.raumgruppe.trim().toLowerCase());
    if (max !== undefined && room.leistungswert_m2_h > max) {
      problems.push(
        `„${room.bezeichnung}“ (${room.raumgruppe}): Leistungswert ${room.leistungswert_m2_h} m²/h liegt über dem Höchstwert ${max} m²/h – das Angebot kann bei Ausschreibungen ausgeschlossen werden.`,
      );
    }
    return {
      bezeichnung: room.bezeichnung,
      raumgruppe: room.raumgruppe,
      flaeche_m2: room.flaeche_m2,
      leistungswert_m2_h: room.leistungswert_m2_h,
      stunden_pro_reinigung: hours(perCleaning),
      reinigungen_pro_jahr: perYear,
      stunden_pro_jahr: hours(perCleaning * perYear),
      exact: perCleaning * perYear,
    };
  });

  const yearHours = rooms.reduce((sum, r) => sum + r.exact, 0);
  const labour = input.stundenlohn_eur * (1 + input.lohnnebenkosten_prozent / 100);
  const overhead = labour * (input.gemeinkosten_prozent / 100);
  const cost = labour + overhead;
  const profit = cost * (input.wagnis_gewinn_prozent / 100);
  const rate = money(cost + profit);
  const monthHours = yearHours / 12;
  const work = money(monthHours * rate);
  const net = money(work + input.material_eur_pro_monat);
  const vat = money(net * (input.ust_prozent / 100));

  return {
    raeume: rooms.map(({ exact: _exact, ...room }) => room),
    stunden: {
      pro_jahr: hours(yearHours),
      pro_monat: hours(monthHours),
      pro_woche: hours(yearHours / input.reinigungswochen_pro_jahr),
    },
    stundensatz: {
      lohn: money(input.stundenlohn_eur),
      lohnnebenkosten: money(labour - input.stundenlohn_eur),
      lohnkosten: money(labour),
      gemeinkosten: money(overhead),
      selbstkosten: money(cost),
      wagnis_gewinn: money(profit),
      verrechnungssatz: rate,
    },
    preis_pro_monat: {
      arbeit: work,
      material: money(input.material_eur_pro_monat),
      netto: net,
      ust: vat,
      brutto: money(net + vat),
    },
    netto_pro_jahr: money(net * 12),
    hinweise: [
      ...problems,
      "Grundlage sind die Werte Ihrer Firma (Stundenlohn laut Kollektivvertrag, Zuschläge, Leistungswerte). Bitte vor dem Versand prüfen.",
    ],
  };
}

const room = z.object({
  bezeichnung: z.string().describe("z. B. Büro 1. OG"),
  raumgruppe: z.string().describe("z. B. Büro, Sanitär, Verkehrsfläche, Stiege"),
  flaeche_m2: z.number().describe("Fläche in m²"),
  leistungswert_m2_h: z.number().describe("Leistungswert der Firma in m² pro Stunde"),
  reinigungen_pro_woche: z.number().describe("z. B. 5 für Montag bis Freitag"),
});

export const cleaningCalculationTool = defineTool({
  name: "reinigung_kalkulieren",
  description:
    "Kalkuliert ein Reinigungsangebot exakt: Stunden je Raum aus Fläche ÷ Leistungswert, Reinigungen pro Jahr, Verrechnungssatz aus Stundenlohn, Lohnnebenkosten, Gemeinkosten sowie Wagnis und Gewinn, dazu Monatspreis netto/brutto. Verwenden Sie ausschließlich Werte der Firma (Kalkulationsgrundlage in der Wissensdatenbank oder vom Benutzer) und erfinden Sie keine Zahlen. Höchstwerte (z. B. nach ÖNORM D 2050) werden geprüft, wenn Sie sie mitgeben; sonst eine leere Liste.",
  risk: "read",
  input: z.object({
    raeume: z.array(room).describe("Alle Räume bzw. Raumgruppen des Objekts"),
    reinigungswochen_pro_jahr: z.number().describe("Meist 52"),
    ausfalltage_pro_jahr: z.number().describe("Feiertage ohne Reinigung, z. B. 11; sonst 0"),
    stundenlohn_eur: z.number().describe("Stundenlohn laut Kollektivvertrag in Euro"),
    lohnnebenkosten_prozent: z.number().describe("Lohnnebenkosten in Prozent des Lohns"),
    gemeinkosten_prozent: z.number().describe("Gemeinkosten in Prozent der Lohnkosten"),
    wagnis_gewinn_prozent: z.number().describe("Wagnis und Gewinn in Prozent der Selbstkosten"),
    material_eur_pro_monat: z.number().describe("Material pro Monat in Euro, sonst 0"),
    ust_prozent: z.number().describe("Umsatzsteuer, in Österreich 20"),
    hoechstwerte: z
      .array(z.object({ raumgruppe: z.string(), max_m2_h: z.number() }))
      .describe("Höchstzulässige Leistungswerte je Raumgruppe; leere Liste, wenn keine vorgegeben"),
  }),
  run: async (input) => calculateCleaning(input),
});
