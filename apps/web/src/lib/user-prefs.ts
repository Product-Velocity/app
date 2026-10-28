/** Per-person preferences kept in the user profile (Supabase user metadata): the width of the item panel and the last screen in each account. */

export const PANEL_WIDTH_DEFAULT = 572;
export const PANEL_WIDTH_MIN = 400;
export const PANEL_WIDTH_MAX = 1100;

/** A width in pixels the panel may take: a whole number between the limits, and never more than 70% of the window when it is known. */
export function clampPanelWidth(width: number, viewport?: number): number {
  const w = Number.isFinite(width) ? Math.round(width) : PANEL_WIDTH_DEFAULT;
  const max = viewport ? Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.floor(viewport * 0.7))) : PANEL_WIDTH_MAX;
  return Math.min(max, Math.max(PANEL_WIDTH_MIN, w));
}

export function panelWidthFromMetadata(meta: Record<string, unknown> | null | undefined): number {
  const v = meta?.panel_width;
  return typeof v === "number" ? clampPanelWidth(v) : PANEL_WIDTH_DEFAULT;
}

/** Screens a person can land on after signing in. Item pages and settings are not remembered: ids are per account and settings are not a place to resume. */
const LANDING_ROOTS = ["/portfolio", "/gantt", "/cards", "/leadership", "/incoming", "/home", "/trash"];
/** Only these query parameters are remembered: the view and the project scope. The open item (?item=) is not. */
const KEPT_PARAMS = ["view", "scope"];

/** The page and the saved view to come back to, or null when this location is not one to remember. Takes a path without the /w/{account} prefix. */
export function sanitizeLocation(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 400 || !raw.startsWith("/") || raw.startsWith("//")) return null;
  let url: URL;
  try { url = new URL(raw, "https://pv.invalid"); } catch { return null; }
  if (url.origin !== "https://pv.invalid") return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (!LANDING_ROOTS.includes(path)) return null;
  const out = new URLSearchParams();
  for (const k of KEPT_PARAMS) { const v = url.searchParams.get(k); if (v && v.length <= 120) out.set(k, v); }
  const q = out.toString();
  return q ? `${path}?${q}` : path;
}

const MAX_ACCOUNTS = 12;
type Locations = Record<string, string>;

export function lastLocationFromMetadata(meta: Record<string, unknown> | null | undefined, tenantId: string): string | null {
  const map = meta?.last_location;
  if (!map || typeof map !== "object") return null;
  return sanitizeLocation((map as Locations)[tenantId]);
}

/** The map to store after the person has been on `path` in this account; the most recent accounts are kept. */
export function withLastLocation(meta: Record<string, unknown> | null | undefined, tenantId: string, path: string): Locations {
  const current = meta?.last_location && typeof meta.last_location === "object" ? (meta.last_location as Locations) : {};
  const next: Locations = {};
  for (const [id, p] of Object.entries(current)) if (id !== tenantId && sanitizeLocation(p)) next[id] = p;
  const kept = Object.entries(next).slice(-(MAX_ACCOUNTS - 1));
  return { ...Object.fromEntries(kept), [tenantId]: path };
}
