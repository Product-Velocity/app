import { FIELDS, FIELD_BY_KEY, KEY_BY_COLUMN, isShipped, type FieldDef } from "./registry";
import { readOnlyReason } from "./fields";

/**
 * The item panel: how each of the 169 fields is shown and edited, and the activity log of one item.
 * Pure logic, so the panel, the detail page and the tests agree.
 */
export type PanelKind =
  | "text" | "longtext" | "number" | "currency" | "date" | "select" | "person" | "boolean" | "group" | "project" | "rank"
  | "tags" | "links" | "relations" | "teams" | "people" | "skills" | "files"
  | "readonly" | "later";

export type PanelField = { kind: PanelKind; /** Why it cannot be edited, or when it arrives. */ reason?: string; phase?: number };

const TAG_FIELDS = new Set(["tags", "target_scope", "live_scope", "target_segments"]);

export function panelField(f: FieldDef): PanelField {
  if (f.key === "stack_rank") return { kind: "rank" };
  if (f.key === "assignees") return { kind: "people" }; // the one GitHub-synced field a person also edits: written to GitHub only after the sync preview is confirmed
  if (!isShipped(f) && f.mode !== "locked" && f.mode !== "computed" && f.mode !== "system") return { kind: "later", phase: f.phase, reason: `Arrives in phase ${f.phase}.` };
  if (f.mode !== "editable") return { kind: "readonly", reason: readOnlyReason(f.key) ?? undefined, ...(isShipped(f) ? {} : { phase: f.phase }) };
  if (f.key === "screenshots") return { kind: "files" };
  if (f.key === "home_project") return { kind: "project" };
  if (f.key === "theme") return { kind: "group" };
  if (f.key === "effort_by_skill") return { kind: "skills" };
  if (f.key === "contributing_teams") return { kind: "teams" };
  if (TAG_FIELDS.has(f.key)) return { kind: "tags" };
  if (f.type === "Links") return { kind: "links" };
  if (f.type === "Relation") return { kind: "relations" };
  switch (f.type) {
    case "Text": case "Person or text": return { kind: "text" };
    case "Long text": return { kind: "longtext" };
    case "Number": return { kind: "number" };
    case "Currency": return { kind: "currency" };
    case "Date": return { kind: "date" };
    case "Select": return { kind: "select" };
    case "Person": return { kind: "person" };
    case "Boolean": return { kind: "boolean" };
    default: return { kind: "readonly", reason: `${f.name} cannot be edited yet.` };
  }
}

export type PanelSection = { group: string; fields: FieldDef[]; /** Every field of the group arrives in a later phase (the panel starts it collapsed). */ allLater: boolean };

/** All fields grouped like the dictionary (sheet order of the groups, field order inside). */
export function panelSections(): PanelSection[] {
  const groups: string[] = [];
  for (const f of FIELDS) if (!groups.includes(f.group)) groups.push(f.group);
  return groups.map((group) => {
    const fields = FIELDS.filter((f) => f.group === group);
    return { group, fields, allLater: fields.every((f) => !isShipped(f)) };
  });
}

// ------------------------------------------------------------------ activity
/** One audit row about this item or one of its related rows (see `item_activity` in the database). */
export type ActivityRow = {
  id: number; at: string; entity: string; entityId: string; field: string; old: unknown; new: unknown; actorId: string | null; via: string;
};
export type ActivityEvent = {
  id: number; at: string; actorId: string | null; via: string;
  entity: string; entityId: string;
  kind: "changed" | "added" | "removed";
  /** Dictionary key of the field, and its label. */
  field: string; label: string;
  old?: unknown; new?: unknown;
  /** For added and removed related rows: what was added or removed, in words. */
  detail?: string;
};

const HOUSEKEEPING = new Set(["id", "tenant_id", "created_at", "created_by", "created_via", "updated_at", "item_id", "deleted_by"]);
const RELATED_FIELD: Record<string, (data: Record<string, unknown>) => string> = {
  item_tags: (d) => ({ tag: "tags", target_scope: "target_scope", live_scope: "live_scope", segment: "target_segments" }[String(d.kind)] ?? "tags"),
  item_links: () => "artifacts",
  item_files: () => "screenshots",
  item_relations: (d) => (d.kind === "related_to" ? "related_to" : "depends_on"),
  item_teams: () => "contributing_teams",
};
const describeRelated = (entity: string, d: Record<string, unknown>): string => {
  if (entity === "item_tags") return String(d.value ?? "");
  if (entity === "item_links") return d.label ? `${d.label} (${d.url})` : String(d.url ?? "");
  if (entity === "item_files") return String(d.name ?? "");
  if (entity === "item_relations") return String(d.related_item_id ?? "");
  if (entity === "item_teams") return String(d.team_id ?? "");
  return "";
};

/** Audit rows to events, newest first: one event per changed item field, one per added or removed related row. */
export function activityEvents(rows: readonly ActivityRow[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const related = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    if (r.entity === "items") {
      if (HOUSEKEEPING.has(r.field)) continue;
      const key = KEY_BY_COLUMN[r.field] ?? r.field;
      if (key === "deleted_at") { // a delete or a restore: the label says which
        out.push({ id: r.id, at: r.at, actorId: r.actorId, via: r.via, entity: "items", entityId: r.entityId, kind: "changed", field: key, label: r.new ? "Moved to the Trash" : "Restored from the Trash", old: r.old, new: r.new });
        continue;
      }
      out.push({ id: r.id, at: r.at, actorId: r.actorId, via: r.via, entity: "items", entityId: r.entityId, kind: "changed", field: key, label: FIELD_BY_KEY[key]?.name ?? r.field, old: r.old, new: r.new });
    } else if (RELATED_FIELD[r.entity]) {
      const k = `${r.entity}|${r.entityId}|${r.at}`;
      related.set(k, [...(related.get(k) ?? []), r]);
    }
  }
  for (const group of related.values()) {
    const first = group[0]!;
    const idRow = group.find((g) => g.field === "id");
    const added = idRow ? idRow.new !== null && idRow.old === null : group.every((g) => g.old === null);
    const removed = idRow ? idRow.new === null && idRow.old !== null : group.every((g) => g.new === null);
    const data: Record<string, unknown> = {};
    for (const g of group) if (!HOUSEKEEPING.has(g.field) || g.field === "item_id") data[g.field] = added ? g.new : removed ? g.old : g.new;
    const key = RELATED_FIELD[first.entity]!(data);
    out.push({
      id: Math.max(...group.map((g) => g.id)), at: first.at, actorId: first.actorId, via: first.via, entity: first.entity, entityId: first.entityId,
      kind: removed ? "removed" : added ? "added" : "changed", field: key, label: FIELD_BY_KEY[key]?.name ?? key, detail: describeRelated(first.entity, data),
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
}

const OWN_SOURCES = new Set(["UI", "API", "Claude MCP", "import"]);
/** Undo from the log: only your own change to an item field, and only while the field still holds what that change set. */
export function canUndoActivity(e: Pick<ActivityEvent, "kind" | "entity" | "field" | "new" | "actorId"> & { via?: string }, me: string | null, current: unknown): { ok: true } | { ok: false; reason: string } {
  if (e.entity !== "items" || e.kind !== "changed") return { ok: false, reason: "Changes to tags, links and other lists are undone with Undo in the panel." };
  if (!me || e.actorId !== me || (e.via && !OWN_SOURCES.has(e.via))) return { ok: false, reason: "You can only undo your own changes." };
  const same = (a: unknown, b: unknown) => a === b || (a == null && b == null) || JSON.stringify(a) === JSON.stringify(b);
  if (!same(current, e.new)) return { ok: false, reason: "The value has changed since. Undo the newer change first." };
  return { ok: true };
}
