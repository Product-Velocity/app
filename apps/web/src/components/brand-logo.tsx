/**
 * The Product Velocity mark and logo (brand guide, 2026-11-10; files in public/brand).
 * The mark is fifteen white pills in a 5·4·3·2·1 triangle on a rounded square in the fixed logo blue (#2270ED, which does not follow a theme).
 * Drawn from the guide's 256-unit grid: tile corner radius 50, pills 23.5 × 33 with full radius. Never stretch, recolour or change the pill count.
 * The name is live text (IBM Plex Sans semibold, ink), never part of the image.
 */
export const PILLS: ReadonlyArray<readonly [number, number]> = [
  [45.5, 30.9], [45.5, 71.3], [45.5, 111.7], [45.5, 152.1], [45.5, 192.5],
  [81.2, 51.1], [81.2, 91.5], [81.2, 131.9], [81.2, 172.3],
  [116.8, 71.3], [116.8, 111.7], [116.8, 152.1],
  [152.1, 91.5], [152.1, 131.9],
  [187.4, 111.7],
];

export const LOGO_BLUE = "#2270ED";

/** The tile mark alone (favicon, avatar, tight spaces). `glyph` draws the pills only, in logo blue, without the tile. */
export function BrandMark({ size = 28, glyph = false, className }: { size?: number; glyph?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 256 256" width={size} height={size} aria-hidden="true" focusable="false" className={className} style={{ display: "block", flex: "none" }}>
      {glyph ? null : <rect width="256" height="256" rx="50" fill={LOGO_BLUE} />}
      {PILLS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="23.5" height="33" rx="11.75" fill={glyph ? LOGO_BLUE : "#ffffff"} />
      ))}
    </svg>
  );
}

/** The mark with the name beside it. `size` is the tile height in px (minimum 24 beside the name); the name scales with it. */
export function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <span className="brand-logo" role="img" aria-label="Product Velocity" style={{ gap: Math.round(size * 0.35) }}>
      <BrandMark size={size} />
      <span className="brand-name" aria-hidden="true" style={{ fontSize: Math.max(13, Math.round(size * 0.5)) }}>Product Velocity</span>
    </span>
  );
}
