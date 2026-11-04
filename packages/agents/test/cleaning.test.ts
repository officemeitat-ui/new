import { describe, expect, it } from "vitest";
import { calculateCleaning, type CleaningInput } from "../src/cleaning";

const base: CleaningInput = {
  raeume: [
    {
      bezeichnung: "Büro EG",
      raumgruppe: "Büro",
      flaeche_m2: 400,
      leistungswert_m2_h: 200,
      reinigungen_pro_woche: 5,
    },
    {
      bezeichnung: "WC-Anlage",
      raumgruppe: "Sanitär",
      flaeche_m2: 40,
      leistungswert_m2_h: 50,
      reinigungen_pro_woche: 5,
    },
  ],
  reinigungswochen_pro_jahr: 52,
  ausfalltage_pro_jahr: 11,
  stundenlohn_eur: 12.37,
  lohnnebenkosten_prozent: 94.6,
  gemeinkosten_prozent: 15,
  wagnis_gewinn_prozent: 10,
  material_eur_pro_monat: 80,
  ust_prozent: 20,
  hoechstwerte: [],
};

describe("cleaning calculation", () => {
  it("computes hours, billing rate and monthly price (hand-checked example)", () => {
    const result = calculateCleaning(base);
    // 400 m² ÷ 200 m²/h = 2 h; 5 × 52 − 11 holidays = 249 cleanings → 498 h; WC 0.8 h × 249 = 199.2 h
    expect(
      result.raeume.map((r) => [
        r.stunden_pro_reinigung,
        r.reinigungen_pro_jahr,
        r.stunden_pro_jahr,
      ]),
    ).toEqual([
      [2, 249, 498],
      [0.8, 249, 199.2],
    ]);
    expect(result.stunden).toEqual({ pro_jahr: 697.2, pro_monat: 58.1, pro_woche: 13.41 });
    // 12.37 × 1.946 = 24.07 · +15 % = 27.68 · +10 % = 30.45
    expect(result.stundensatz).toEqual({
      lohn: 12.37,
      lohnnebenkosten: 11.7,
      lohnkosten: 24.07,
      gemeinkosten: 3.61,
      selbstkosten: 27.68,
      wagnis_gewinn: 2.77,
      verrechnungssatz: 30.45,
    });
    // 58.1 h × 30.45 € = 1769.15 € + 80 € material
    expect(result.preis_pro_monat).toEqual({
      arbeit: 1769.15,
      material: 80,
      netto: 1849.15,
      ust: 369.83,
      brutto: 2218.98,
    });
    expect(result.netto_pro_jahr).toBe(22189.8);
  });

  it("warns when a performance value exceeds the company's maximum (e.g. ÖNORM D 2050)", () => {
    const result = calculateCleaning({
      ...base,
      hoechstwerte: [{ raumgruppe: "büro", max_m2_h: 180 }],
    });
    expect(result.hinweise[0]).toMatch(/Büro EG.*200 m²\/h liegt über dem Höchstwert 180 m²\/h/);
  });

  it("refuses missing or nonsensical figures instead of guessing", () => {
    expect(() => calculateCleaning({ ...base, stundenlohn_eur: 0 })).toThrow(/Stundenlohn/);
    expect(() => calculateCleaning({ ...base, raeume: [] })).toThrow(/mindestens einen Raum/);
    expect(() =>
      calculateCleaning({ ...base, raeume: [{ ...base.raeume[0]!, leistungswert_m2_h: 0 }] }),
    ).toThrow(/Leistungswert/);
  });
});
