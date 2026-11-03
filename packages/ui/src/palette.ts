/**
 * Generates an accessible colour palette from a single brand colour (white-label, M1).
 * Every foreground/background pair is checked against WCAG 2.2 contrast ratios.
 */

export type Rgb = { r: number; g: number; b: number };

export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) throw new Error(`Ungültige Farbe: ${hex}`);
  const n = Number.parseInt(match[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix a colour with white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return rgbToHex({ r: r + (target - r) * t, g: g + (target - g) * t, b: b + (target - b) * t });
}

/** Lightens or darkens `color` in small steps until it reaches `minRatio` against `background`. */
export function ensureContrast(color: string, background: string, minRatio: number): string {
  if (contrastRatio(color, background) >= minRatio) return color;
  const lighten = relativeLuminance(background) < 0.5;
  for (let step = 1; step <= 20; step++) {
    const candidate = shade(color, (lighten ? 1 : -1) * step * 0.05);
    if (contrastRatio(candidate, background) >= minRatio) return candidate;
  }
  return lighten ? "#ffffff" : "#000000";
}

export const NEUTRAL = {
  light: {
    background: "#ffffff",
    foreground: "#0b1220",
    muted: "#f4f5f7",
    mutedForeground: "#5b6474",
    border: "#e3e6eb",
    card: "#ffffff",
  },
  dark: {
    background: "#0b0f17",
    foreground: "#eef1f6",
    muted: "#161b25",
    mutedForeground: "#9aa3b2",
    border: "#252c39",
    card: "#10151f",
  },
} as const;

export type ThemeTokens = {
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  card: string;
  primary: string;
  primaryForeground: string;
  accent: string;
  accentForeground: string;
  ring: string;
};

function pickForeground(background: string): string {
  const light = "#ffffff";
  const dark = NEUTRAL.light.foreground;
  return contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark;
}

function buildTheme(brand: string, mode: "light" | "dark"): ThemeTokens {
  const neutral = NEUTRAL[mode];
  // Primary must stand out from the page (3:1 for UI components, WCAG 1.4.11) and carry
  // readable text (4.5:1 for normal text, WCAG 1.4.3).
  let primary = ensureContrast(brand, neutral.background, 3);
  let primaryForeground = pickForeground(primary);
  if (contrastRatio(primary, primaryForeground) < 4.5) {
    primary = ensureContrast(primary, primaryForeground, 4.5);
    primaryForeground = pickForeground(primary);
  }
  const accent = mode === "light" ? shade(brand, 0.9) : shade(brand, -0.75);
  const accentForeground = ensureContrast(
    mode === "light" ? shade(brand, -0.45) : shade(brand, 0.6),
    accent,
    4.5,
  );
  return { ...neutral, primary, primaryForeground, accent, accentForeground, ring: primary };
}

export function generatePalette(brand: string): { light: ThemeTokens; dark: ThemeTokens } {
  hexToRgb(brand); // validate early
  return { light: buildTheme(brand, "light"), dark: buildTheme(brand, "dark") };
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function declarations(tokens: ThemeTokens): string {
  return Object.entries(tokens)
    .map(([key, value]) => `--${kebab(key)}:${value};`)
    .join("");
}

/** CSS for a `<style>` tag: light tokens on :root, dark tokens on `.dark`. */
export function paletteToCss(brand: string): string {
  const { light, dark } = generatePalette(brand);
  return `:root{${declarations(light)}}.dark{${declarations(dark)}}`;
}
