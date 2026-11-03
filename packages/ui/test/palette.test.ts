import { describe, expect, it } from "vitest";
import { contrastRatio, generatePalette, hexToRgb, paletteToCss } from "../src/palette";

const BRANDS = ["#2454d6", "#ffcc00", "#00a86b", "#e30613", "#111111", "#f5f5f5", "#7c3aed"];

describe("generatePalette", () => {
  it.each(BRANDS)("keeps %s accessible in light and dark mode", (brand) => {
    const palette = generatePalette(brand);
    for (const theme of [palette.light, palette.dark]) {
      expect(contrastRatio(theme.primary, theme.primaryForeground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.primary, theme.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(theme.accentForeground, theme.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.foreground, theme.background)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(theme.mutedForeground, theme.background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps a brand colour that is already accessible", () => {
    expect(generatePalette("#2454d6").light.primary).toBe("#2454d6");
  });

  it("rejects invalid colours", () => {
    expect(() => hexToRgb("blue")).toThrow(/Ungültige Farbe/);
  });

  it("renders CSS custom properties for both themes", () => {
    const css = paletteToCss("#2454d6");
    expect(css).toMatch(/^:root\{--background:#ffffff;/);
    expect(css).toContain(".dark{");
    expect(css).toContain("--primary-foreground:");
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
