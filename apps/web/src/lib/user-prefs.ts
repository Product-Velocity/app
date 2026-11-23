/** Per-person preferences kept in the user profile (Supabase user metadata): the width of the item panel, the text size and the last screen in each account. */

/** Text size as a percentage of the default 13px design. The header offers the steps one at a time. */
export const TEXT_SIZES = [90, 100, 110, 120, 130] as const;
export const TEXT_SIZE_DEFAULT = 100;

/** The nearest allowed step for any stored or submitted value. */
export function clampTextSize(size: unknown): number {
  if (typeof size !== "number" || !Number.isFinite(size)) return TEXT_SIZE_DEFAULT;
  return TEXT_SIZES.reduce((best, s) => (Math.abs(s - size) < Math.abs(best - size) ? s : best), TEXT_SIZE_DEFAULT as number);
}

export const textSizeFromMetadata = (meta: Record<string, unknown> | null | undefined): number => clampTextSize(meta?.text_size);

/** The step after `current` in a direction; stays put at either end. */
export function stepTextSize(current: number, direction: -1 | 1): number {
  const i = TEXT_SIZES.indexOf(clampTextSize(current) as (typeof TEXT_SIZES)[number]);
  return TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, i + direction))]!;
}

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

// ------------------------------------------------------------------ followed initiatives (issue #635)
/** Most initiatives a person can follow in one account; the list is kept in their own profile, so it follows them to every device. */
export const MAX_FOLLOWED = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Followed = Record<string, string[]>;

/** Only well-formed ids, once each, at most MAX_FOLLOWED (the newest kept). */
export function cleanFollowed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) if (typeof v === "string" && UUID.test(v) && !out.includes(v)) out.push(v);
  return out.slice(-MAX_FOLLOWED);
}

export function followedFromMetadata(meta: Record<string, unknown> | null | undefined, tenantId: string): string[] {
  const map = meta?.followed_items;
  return map && typeof map === "object" ? cleanFollowed((map as Followed)[tenantId]) : [];
}

/** The map to store after the person's list in this account became `ids`; the most recent accounts are kept. */
export function withFollowed(meta: Record<string, unknown> | null | undefined, tenantId: string, ids: unknown): Followed {
  const current = meta?.followed_items && typeof meta.followed_items === "object" ? (meta.followed_items as Followed) : {};
  const next: Followed = {};
  for (const [id, list] of Object.entries(current)) { const l = cleanFollowed(list); if (id !== tenantId && l.length > 0) next[id] = l; }
  const kept = Object.entries(next).slice(-(MAX_ACCOUNTS - 1));
  const mine = cleanFollowed(ids);
  return { ...Object.fromEntries(kept), ...(mine.length > 0 ? { [tenantId]: mine } : {}) };
}

/** Follow or stop following one initiative. `full` is true when the list is at its limit and the initiative was not added. */
export function toggleFollowed(list: readonly string[], id: string): { list: string[]; following: boolean; full: boolean } {
  if (list.includes(id)) return { list: list.filter((x) => x !== id), following: false, full: false };
  if (list.length >= MAX_FOLLOWED) return { list: [...list], following: false, full: true };
  return { list: [...list, id], following: true, full: false };
}
