/**
 * List fields of an item: tags, markets, segments, links, relations and teams. They live in their own tables
 * (item_tags, item_links, item_relations, item_teams); the panel edits each list as a whole and the data source
 * works out which rows to add and remove.
 */
export const RELATED_FIELDS = ["tags", "target_scope", "live_scope", "target_segments", "artifacts", "depends_on", "related_to", "contributing_teams"] as const;
export type RelatedField = (typeof RELATED_FIELDS)[number];
export type Link = { label: string; url: string };
export type RelatedValues = {
  tags: string[]; target_scope: string[]; live_scope: string[]; target_segments: string[];
  artifacts: Link[]; depends_on: string[]; related_to: string[]; contributing_teams: string[];
};
export const emptyRelated = (): RelatedValues => ({ tags: [], target_scope: [], live_scope: [], target_segments: [], artifacts: [], depends_on: [], related_to: [], contributing_teams: [] });
export const isRelatedField = (key: string): key is RelatedField => (RELATED_FIELDS as readonly string[]).includes(key);

export type RelatedCtx = { itemId: string; itemIds: readonly string[]; teamIds: readonly string[] };
export type Cleaned<T> = { ok: true; value: T } | { ok: false; error: string };
const MAX_ENTRIES = 50;

export function cleanRelated(field: RelatedField, raw: readonly unknown[], ctx: RelatedCtx): Cleaned<unknown[]> {
  if (raw.length > MAX_ENTRIES * 2) return { ok: false, error: `At most ${MAX_ENTRIES} entries.` };
  switch (field) {
    case "artifacts": {
      const out: Link[] = [];
      for (const x of raw) {
        const l = x as Partial<Link>;
        const url = String(l.url ?? "").trim();
        const label = String(l.label ?? "").trim();
        if (url === "" && label === "") continue;
        if (!/^https?:\/\//i.test(url)) return { ok: false, error: "A link must start with http:// or https://." };
        if (url.length > 2000) return { ok: false, error: "Keep a link under 2000 characters." };
        if (label.length > 200) return { ok: false, error: "Keep a link label under 200 characters." };
        if (!out.some((o) => o.url === url && o.label === label)) out.push({ label, url });
      }
      return out.length > MAX_ENTRIES ? { ok: false, error: `At most ${MAX_ENTRIES} entries.` } : { ok: true, value: out };
    }
    case "depends_on": case "related_to": {
      const out: string[] = [];
      for (const x of raw) {
        const id = String(x);
        if (id === ctx.itemId) return { ok: false, error: "An initiative cannot refer to itself." };
        if (!ctx.itemIds.includes(id)) return { ok: false, error: "That initiative does not exist." };
        if (!out.includes(id)) out.push(id);
      }
      return out.length > MAX_ENTRIES ? { ok: false, error: `At most ${MAX_ENTRIES} entries.` } : { ok: true, value: out };
    }
    case "contributing_teams": {
      const out: string[] = [];
      for (const x of raw) {
        const id = String(x);
        if (!ctx.teamIds.includes(id)) return { ok: false, error: "That team does not exist." };
        if (!out.includes(id)) out.push(id);
      }
      return { ok: true, value: out };
    }
    default: {
      const out: string[] = [];
      for (const x of raw) {
        const t = String(x).replace(/\s+/g, " ").trim();
        if (t === "") continue;
        if (t.length > 80) return { ok: false, error: "Keep each tag under 80 characters." };
        if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
      }
      return out.length > MAX_ENTRIES ? { ok: false, error: `At most ${MAX_ENTRIES} entries.` } : { ok: true, value: out };
    }
  }
}

/** Effort by skill: person-weeks per skill (backend, frontend, data, platform, ...). Empty means no estimate. */
export function cleanSkills(raw: unknown): Cleaned<Record<string, number> | null> {
  if (raw === null || raw === undefined || typeof raw !== "object") return { ok: true, value: null };
  const out: Record<string, number> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 20) return { ok: false, error: "At most 20 skills." };
  for (const [k, v] of entries) {
    const name = k.trim();
    if (name === "") continue;
    if (name.length > 40) return { ok: false, error: "Keep a skill name under 40 characters." };
    const n = typeof v === "number" ? v : /^\s*-?\d+(\.\d+)?\s*$/.test(String(v)) ? Number(v) : NaN;
    if (!Number.isFinite(n)) return { ok: false, error: `Person-weeks for ${name} must be a number.` };
    if (n < 0 || n > 999) return { ok: false, error: `Person-weeks for ${name} must be between 0 and 999.` };
    if (n > 0) out[name] = n;
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}
