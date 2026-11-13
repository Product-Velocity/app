import type { CSSProperties, ReactNode } from "react";
import { PILLS, LOGO_BLUE } from "./brand-logo";

/**
 * The loading and sync indicator (brand guide, "Loading and sync", chosen 2026-11-13: the Rank loader).
 * The logo's fifteen pills light one by one in reading order (the order of PILLS: column by column, top to bottom),
 * 90 ms apart, one loop about 1.5 s. Only opacity changes (22% to 100%); the pills never move, scale or change colour.
 * Pills only, in the fixed logo blue (white on a `brand` button), no tile, never a different count. The glyph is
 * decorative: a word always sits beside it (see `Loading`). With reduced motion it stays still at 100%.
 */
export function PillLoader({ size = 16, tone = "blue" }: { size?: number; tone?: "blue" | "white" }) {
  const fill = tone === "white" ? "#ffffff" : LOGO_BLUE;
  return (
    <svg className="pill-loader" viewBox="0 0 256 256" width={size} height={size} aria-hidden="true" focusable="false" style={{ display: "block", flex: "none" }}>
      {PILLS.map(([x, y], i) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="23.5" height="33" rx="11.75" fill={fill} style={{ "--i": i } as CSSProperties} />
      ))}
    </svg>
  );
}

/**
 * A loading line: the glyph and a word, announced as a status. It becomes visible only after 300 ms (CSS), so a quick load
 * never flashes. `inline` renders a span for use inside a line of text; the default is a paragraph.
 */
export function Loading({ children, size = 16, inline = false }: { children: ReactNode; size?: number; inline?: boolean }) {
  const body = <><PillLoader size={size} /><span>{children}</span></>;
  return inline
    ? <span className="pv-loading muted" role="status">{body}</span>
    : <p className="pv-loading muted" role="status">{body}</p>;
}
