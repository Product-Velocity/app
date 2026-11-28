import { cleanReason, type Moscow, type MoscowResult } from "@pv/domain";

/** The values of the MoSCoW field on an initiative (dictionary field 32). */
export const MOSCOW_VALUES = ["Must", "Should", "Could", "Won't"] as const;
export type MoscowValue = (typeof MOSCOW_VALUES)[number];
const FROM_CHOICE: Record<Moscow, MoscowValue> = { must: "Must", should: "Should", could: "Could", wont: "Won't" };
export const moscowValue = (c: Moscow): MoscowValue => FROM_CHOICE[c];
const isValue = (v: unknown): v is MoscowValue => typeof v === "string" && (MOSCOW_VALUES as readonly string[]).includes(v);

/** One initiative of a MoSCoW vote as the vote and the field see it today (issue #746, slice 2). */
export type MoscowRow = { itemId: string; code: string; name: string; current: MoscowValue | null; suggested: MoscowValue; tied: boolean; contested: boolean };

type Link = { id: string; item_id: string | null };
type ItemRow = { id: string; item_code: string; initiative_name: string; moscow: string | null; deleted_at: string | null };

/** The initiatives of a closed MoSCoW session that can still be set: still there and not in the Trash. `skipped` counts the others. */
export function moscowRows(results: MoscowResult[], links: Link[], items: ItemRow[]): { rows: MoscowRow[]; skipped: number } {
  const itemOf = new Map(links.map((l) => [l.id, l.item_id]));
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows: MoscowRow[] = [];
  let skipped = 0;
  for (const m of results) {
    const id = itemOf.get(m.itemId);
    const it = id ? byId.get(id) : undefined;
    if (!id || !it || it.deleted_at) { skipped++; continue; }
    rows.push({ itemId: id, code: it.item_code, name: it.initiative_name, current: isValue(it.moscow) ? it.moscow : null, suggested: moscowValue(m.suggested), tied: m.tied, contested: m.contested });
  }
  return { rows, skipped };
}

export type MoscowChange = { item: string; from: MoscowValue | null; to: MoscowValue; reason?: string };
export type MoscowPlan =
  | { ok: true; changes: MoscowChange[]; scope: "all" | "selection"; differing: string[] }
  | { ok: false; reason: "pick-one" | "stale" | "nothing" | "bad-value" | "reason-needed"; ids?: string[] };

/**
 * What applying the chosen initiatives would do. `seen` is the MoSCoW the person saw for each ("" for none); if it differs from today's value the
 * field changed since the preview and the person is asked again. `finals` is the value the person wants (the vote's suggestion when left out).
 * An initiative whose final value is what it already is changes nothing. Wherever the final value differs from what the vote suggested, a reason
 * is needed; the database checks this again and works out the suggestion itself from the stored vote.
 */
export function planMoscow(rows: MoscowRow[], selected: string[], seen: Record<string, string>, finals: Record<string, unknown> = {}, reasons: Record<string, unknown> = {}): MoscowPlan {
  const chosen = rows.filter((r) => selected.includes(r.itemId));
  if (chosen.length === 0) return { ok: false, reason: "pick-one" };
  if (chosen.some((r) => (seen[r.itemId] ?? "") !== (r.current ?? ""))) return { ok: false, reason: "stale" };
  const changes: MoscowChange[] = [];
  const differing: string[] = [];
  const missing: string[] = [];
  for (const r of chosen) {
    const to = finals[r.itemId] === undefined || finals[r.itemId] === "" ? r.suggested : finals[r.itemId];
    if (!isValue(to)) return { ok: false, reason: "bad-value" };
    if (to === r.current) continue;
    const change: MoscowChange = { item: r.itemId, from: r.current, to };
    if (to !== r.suggested) {
      differing.push(r.itemId);
      const text = cleanReason(reasons[r.itemId]);
      if (text) change.reason = text; else missing.push(r.itemId);
    }
    changes.push(change);
  }
  if (missing.length > 0) return { ok: false, reason: "reason-needed", ids: missing };
  if (changes.length === 0) return { ok: false, reason: "nothing" };
  return { ok: true, changes, scope: chosen.length === rows.length ? "all" : "selection", differing };
}

/** What the page says after an apply or an undo (or why it did not happen). */
export const MOSCOW_STATUS: Record<string, string> = {
  applied: "The MoSCoW was set. You can undo it below until someone changes it again.",
  undone: "The change was undone and the previous MoSCoW values are back.",
  "pick-one": "Choose at least one initiative.",
  "bad-value": "One of the values is not Must, Should, Could or Won't, so nothing was changed.",
  "reason-needed": "Give a reason for every initiative whose final value differs from what the vote suggested. Nothing was changed.",
  stale: "A MoSCoW changed since you looked at it, so nothing was changed. Review the suggestion again.",
  nothing: "The MoSCoW values already are what you chose, so there is nothing to apply.",
  "cannot-undo": "A MoSCoW changed after this was applied, so it cannot be undone without overwriting that change. Nothing was changed.",
  "not-allowed": "Only an admin who is a person can set the MoSCoW from a vote.",
  failed: "We could not set the MoSCoW. Nothing was changed.",
};
