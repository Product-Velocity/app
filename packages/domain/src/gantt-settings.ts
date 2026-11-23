import { ganttGroupOptions, isZoom, type Zoom } from "./gantt";

/** What a saved view remembers about the Gantt besides its filters (issue #622). Groups are field keys; "" means none. */
export type GanttDensity = "compact" | "comfortable";
export type GanttSettings = { zoom: Zoom; g1: string; g2: string; density: GanttDensity };

export const GANTT_FALLBACK: GanttSettings = { zoom: "month", g1: "theme", g2: "home_project", density: "compact" };
export const isDensity = (v: unknown): v is GanttDensity => v === "compact" || v === "comfortable";

/** Makes stored or pasted Gantt settings safe: anything unknown falls back to the default; no object at all gives undefined. */
export function sanitizeGanttSettings(input: unknown): GanttSettings | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const o = input as Record<string, unknown>;
  const keys = ganttGroupOptions().map((g) => g.key);
  const group = (v: unknown, fallback: string) => (typeof v === "string" && keys.includes(v) ? v : fallback);
  const g1 = group(o.g1, GANTT_FALLBACK.g1);
  const g2raw = group(o.g2, GANTT_FALLBACK.g2);
  return { zoom: isZoom(o.zoom) ? o.zoom : GANTT_FALLBACK.zoom, g1, g2: g1 && g2raw !== g1 ? g2raw : "", density: isDensity(o.density) ? o.density : GANTT_FALLBACK.density };
}

export const sameGanttSettings = (a: GanttSettings | undefined, b: GanttSettings | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
