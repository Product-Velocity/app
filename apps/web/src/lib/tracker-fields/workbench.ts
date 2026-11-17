import type { TrackerCatalog } from "./catalog";
import { tableRows, trackerFieldLinks, type LinkContext } from "./links";
import type { ChangeRowView, StaticRowView } from "./view";

// The one field table of the mapping section (decision 2026-11-16-tracker-settings-sections): every Product Velocity field and where it goes, the tracker's own
// fields that nothing uses, and the setting of each, in one list with filters. Pure, so the filters are tested without a browser. It decides nothing about what
// Sync does: it reads the mapping view the page builds from the slots and the saved settings.

export type WbFilter = "synced" | "changeable" | "readonly" | "notsynced" | "never" | "unlinked" | "all";
export const WB_FILTERS: readonly WbFilter[] = ["synced", "changeable", "readonly", "notsynced", "never", "unlinked", "all"];
export const DEFAULT_FILTER: WbFilter = "synced";

/** What a Product Velocity field row is, for the filters. A row can be in several: a changeable field that is switched on is also synced. */
export type WbFlags = { synced: boolean; changeable: boolean; readonly: boolean; notsynced: boolean; never: boolean };

/** Whether Sync does something with a changeable field right now, given the person's own setting. */
export function isSyncedNow(r: ChangeRowView): boolean {
  if (r.direction === "not_synced" || r.direction === "never") return false;
  const c = r.control;
  if (c.type === "toggle") return c.on;
  if (c.type === "select") return c.value !== "__off" && (c.value !== "" || c.blank.startsWith("Default"));
  if (c.type === "priority") return Object.values(c.values).some(Boolean);
  if (c.type === "board") return c.current !== null;
  return true;
}

export function changeFlags(r: ChangeRowView): WbFlags {
  const synced = isSyncedNow(r);
  return { synced, changeable: true, readonly: false, notsynced: !synced, never: false };
}

export function staticFlags(r: StaticRowView): WbFlags {
  return {
    synced: r.direction === "to_tracker" || r.direction === "two_way" || r.direction === "from_tracker",
    changeable: false,
    readonly: r.direction === "from_tracker",
    notsynced: r.direction === "not_synced",
    never: r.direction === "never",
  };
}

export function flagMatches(f: WbFlags, filter: WbFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unlinked") return false; // the tracker's own unused fields are a separate list
  return f[filter];
}

/** Case-insensitive search over the words of a row; every typed word must be found. */
export function textMatches(haystack: string, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const h = haystack.toLowerCase();
  return words.every((w) => h.includes(w));
}

export function filterCounts(flags: readonly WbFlags[], unlinked: number): Record<WbFilter, number> {
  const n = (f: Exclude<WbFilter, "unlinked" | "all">) => flags.filter((x) => x[f]).length;
  return { synced: n("synced"), changeable: n("changeable"), readonly: n("readonly"), notsynced: n("notsynced"), never: n("never"), unlinked, all: flags.length + unlinked };
}

/** A tracker field that no Product Velocity field uses: shown under "fields not linked", ignored by Sync. */
export type UnlinkedField = { key: string; name: string; id: string; typeLabel: string; custom: boolean; source: string | null; options: string[]; filled: number | null; sampled: number | null };

/** The tracker's own fields that no slot of the given projects names, across every group of the catalog, and the first group that could not be read. */
export function unlinkedFields(catalog: TrackerCatalog | null, contexts: readonly LinkContext[]): { fields: UnlinkedField[]; error: string | null; /** What a part that has nothing to list says (for example a missing App permission). */ notes: string[] } {
  if (!catalog) return { fields: [], notes: [], error: "The fields of this connection could not be read just now. Try again in a minute." };
  const links = trackerFieldLinks(catalog.tracker, contexts);
  const fields = catalog.groups.flatMap((g) => tableRows(g.entries, links).filter((r) => r.links.length === 0).map((r) => ({ key: `${g.id}:${r.source ?? ""}:${r.id}`, name: r.name, id: r.id, typeLabel: r.typeLabel, custom: r.custom, source: r.source ?? (catalog.groups.length > 1 ? g.title : null), options: r.options, filled: r.filled, sampled: r.sampled })));
  const bad = catalog.groups.find((g) => g.error);
  return { fields, notes: catalog.groups.filter((g) => g.note && g.entries.length === 0).map((g) => g.note!), error: bad ? `${bad.title}: ${bad.error}` : null };
}
