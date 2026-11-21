import { ImageResponse } from "next/og";

export const alt = "Product Velocity: agentic product management platform. Deliver bigger, better outcomes. Faster.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The picture shown when a link to the site is shared: brand blue, the tagline and the pill motif. */
export default function Image() {
  const pills = [5, 4, 3, 2, 1];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#2270ED", color: "#fff", padding: 72 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
          {pills.map((n, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Array.from({ length: n }).map((_, j) => <div key={j} style={{ width: 34, height: 48, borderRadius: 17, background: "rgba(255,255,255,.9)" }} />)}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 28, letterSpacing: 2, textTransform: "uppercase", opacity: 0.85 }}>Product Velocity · Agentic product management platform</div>
          <div style={{ fontSize: 62, fontWeight: 700, lineHeight: 1.08, maxWidth: 1000 }}>Deliver bigger, better outcomes. Faster.</div>
        </div>
      </div>
    ),
    size,
  );
}
