/**
 * Company brand colours (issue #750). A workspace gives a main and an accent colour; the screens never use them raw. This turns them into the set the
 * brand guide needs and guarantees WCAG AA: text on white at least 4.5:1, text on a brand fill at least 4.5:1, a focus ring or control edge at least 3:1.
 * Pure functions, no I/O. Colours are #rrggbb in and out.
 */
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#2270ED", "2270ed" or "#27e" become "#2270ed" ; anything else is null. */
export function normalizeHex(input: unknown): string | null {
  const m = HEX.exec(String(input ?? "").trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`;
}

type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (c: Rgb) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** Relative luminance as in WCAG 2. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes `a` with `b` by `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const x = toRgb(a), y = toRgb(b);
  return toHex(x.map((v, i) => v + (y[i]! - v) * t) as Rgb);
}

/** Darkens `hex` step by step towards black until it reaches `min` contrast against every background given. Always terminates (black passes). */
export function darkenToContrast(hex: string, backgrounds: string[], min: number): string {
  let c = hex;
  for (let i = 0; i <= 40; i++) {
    if (backgrounds.every((bg) => contrast(c, bg) >= min)) return c;
    c = mix(c, "#000000", 0.05);
  }
  return "#000000";
}

export const WHITE = "#ffffff";
const INK = "#111827";

export type BrandPalette = {
  /** Fills: primary buttons, selection, the capsule. */
  brand: string;
  /** Text on a brand fill: white or near-black, whichever reads better (at least 4.5:1). */
  onBrand: string;
  /** Brand-coloured text and pressed states (at least 4.5:1 on white and on the tint). */
  brandStrong: string;
  /** Selected rows and quiet highlights: the brand mixed into white. */
  brandTint: string;
  /** Focus ring and control edges (at least 3:1 on white). */
  ring: string;
  /** The accent, as given, for non-text decoration only. */
  accent: string;
  /** The accent as text (at least 4.5:1 on white). */
  accentText: string;
  /** What was changed to make it readable, in words, for the person who set the colours. */
  notes: string[];
};

export type PaletteResult = { ok: true; palette: BrandPalette } | { ok: false; error: string };

/** The set of colours a screen needs from one or two brand colours. Never refuses a valid colour: it adjusts and says what it adjusted. */
export function derivePalette(primary: unknown, accent?: unknown): PaletteResult {
  const p = normalizeHex(primary);
  if (!p) return { ok: false, error: "The main colour must be a hex colour such as #2270ED." };
  const a = accent === undefined || accent === null || String(accent).trim() === "" ? p : normalizeHex(accent);
  if (!a) return { ok: false, error: "The accent colour must be a hex colour such as #F59E0B." };
  const notes: string[] = [];
  // white if it reads (the usual case), else the near-black of the app, else pure black, which always does (one of white and black reaches 4.5:1 on any colour)
  const onBrand = contrast(WHITE, p) >= 4.5 ? WHITE : contrast(INK, p) >= 4.5 ? INK : "#000000";
  const tint = mix(p, WHITE, 0.9);
  const strong = darkenToContrast(p, [WHITE, tint], 4.5);
  if (strong !== p) notes.push(`Brand-coloured text is a darker ${strong} so it reads at 4.5:1 on white (your ${p} reads at ${contrast(p, WHITE).toFixed(1)}:1).`);
  if (onBrand !== WHITE) notes.push(`Text on your main colour is dark, because white on ${p} reads at only ${contrast(WHITE, p).toFixed(1)}:1.`);
  const ring = darkenToContrast(p, [WHITE], 3);
  if (ring !== p) notes.push(`Focus rings and control edges use a darker ${ring} so they are visible (3:1 on white).`);
  const accentText = darkenToContrast(a, [WHITE], 4.5);
  if (accentText !== a) notes.push(`The accent is used as text only in a darker ${accentText} (4.5:1 on white).`);
  return { ok: true, palette: { brand: p, onBrand, brandStrong: strong, brandTint: tint, ring, accent: a, accentText, notes } };
}

/** CSS variables for the voting screens (they read the brand guide names). */
export function voterVars(p: BrandPalette): Record<string, string> {
  return { "--brand": p.brand, "--on-brand": p.onBrand, "--brand-strong": p.brandStrong, "--brand-tint": p.brandTint, "--brand-ring": p.ring };
}

/** CSS variables for the whole app: the brand guide names and the older names the app still uses (--blue, --blue-text and the two tints). */
export function appVars(p: BrandPalette): Record<string, string> {
  return {
    ...voterVars(p),
    "--blue": p.brand, "--blue-text": p.brandStrong, "--blue-tint-1": p.brandTint, "--blue-tint-2": mix(p.brand, WHITE, 0.95),
  };
}
