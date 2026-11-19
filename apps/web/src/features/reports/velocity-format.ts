import type { StageId, StageKind } from "@pv/domain";

/** The unit of the Velocity report: the calculations are in days, the screen shows weeks or days. */
export type Unit = "weeks" | "days";
export const UNITS: readonly { id: Unit; label: string }[] = [{ id: "weeks", label: "Weeks" }, { id: "days", label: "Days" }];
export const parseUnit = (v: string | null | undefined): Unit => (v === "days" ? "days" : "weeks");

/** Days in the unit shown. */
export const inUnit = (days: number, unit: Unit): number => (unit === "weeks" ? days / 7 : days);
/** A number already in the unit: one decimal for weeks, whole days. */
export const fmtNum = (v: number, unit: Unit): string => (unit === "weeks" ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v)));
export const unitShort = (unit: Unit): string => (unit === "weeks" ? "wk" : "d");
/** Days, written in the unit with its short name: "21.9 wk". */
export const fmtDays = (days: number | null | undefined, unit: Unit): string => (days === null || days === undefined ? "–" : `${fmtNum(inUnit(days, unit), unit)} ${unitShort(unit)}`);
/** Decision times and waits are always whole days. */
export const fmtWholeDays = (days: number | null | undefined): string => (days === null || days === undefined ? "–" : `${Math.round(days)} d`);

/** A comparison in words and an arrow, never colour alone: "▲ 14% slower", "▼ 9% faster", "about the same". */
export function compare(value: number, reference: number): { text: string; tone: "slow" | "fast" | "same" } {
  const pct = Math.round((value / reference - 1) * 100);
  if (!Number.isFinite(pct) || Math.abs(pct) < 5) return { text: "about the same", tone: "same" };
  return pct > 0 ? { text: `▲ ${pct}% slower`, tone: "slow" } : { text: `▼ ${-pct}% faster`, tone: "fast" };
}
/** The size-adjusted ratio of a group ("1.2" is 20% slower than its size mix predicts). */
export function adjustedText(ratio: number | null): string | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  return ratio >= 1.05 ? `size-adj. +${pct}%` : ratio <= 0.95 ? `size-adj. −${pct}%` : `size-adj. ±${pct}%`;
}

/** The five zones of the bell, fastest to slowest: green, light green, brand blue, light amber, amber. Each is also named in words under the chart. */
export const ZONE_COLOURS = ["#0f8a6a", "#7cc9b2", "#2270ed", "#eab75a", "#c27a00"] as const;
/** The colours of the work stages (the same phase colours as Roadmap Health); waiting is grey, hatched for a gate decision. */
export const STAGE_COLOURS: Record<StageId, string> = {
  discover: "#2270ed", wait_a: "#aeb6c4", define: "#0f8a6a", wait_b: "#aeb6c4", queue_build: "#c5ccd8", build: "#c27a00", test: "#a23b8f", experiment: "#2b7fb8", wait_c: "#aeb6c4", queue_roll: "#c5ccd8",
};
export const KIND_COLOURS: Record<StageKind, string> = { work: "#2270ed", gate: "#aeb6c4", queue: "#c5ccd8" };
/** A diagonal hatch for the time an initiative waited for a gate decision (a canvas pattern, which the SVG chart accepts as a fill). */
export function hatchFill(base = "#e3e7ee", line = "#8a96aa"): string | { image: HTMLCanvasElement; repeat: "repeat" } {
  if (typeof document === "undefined") return base;
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const g = c.getContext("2d");
  if (!g) return base;
  g.fillStyle = base; g.fillRect(0, 0, 8, 8);
  g.strokeStyle = line; g.lineWidth = 1.6; g.beginPath();
  g.moveTo(0, 8); g.lineTo(8, 0); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(7, 9); g.lineTo(9, 7);
  g.stroke();
  return { image: c, repeat: "repeat" };
}
export const INK = "#111827";
export const INK_MUTED = "#4b5563";
export const GRID_LINE = "#edeff3";
export const AMBER_TEXT = "#7a4a00";
export const GREEN_TEXT = "#0b6b52";
