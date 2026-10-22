import { applyMove, columnOnItems, emptyRelated, FIELD_BY_KEY, type ActivityRow, type EditableField, type RelatedField, type RelatedValues } from "@pv/domain";
import type { CreateManyResult, NewItem, PortfolioDataSource, SaveResult } from "./data-source";
import type { LoadedItem } from "./types";

export type Op = { type: "update"; itemId: string; field: string; value: unknown; expected?: unknown } | { type: "move"; itemId: string; to: number };

/** In-memory data source for tests and the test page. Can be slow or fail on demand. */
export class MemoryDataSource implements PortfolioDataSource {
  readonly calls: Op[] = [];
  items: LoadedItem[];
  latencyMs = 0;
  /** Return an error message to make that operation fail. */
  failWhen: ((op: Op) => string | null) | null = null;
  /** Make the next adds fail with this message. */
  failCreate: string | null = null;
  readonly createCalls: { count: number; via?: string }[] = [];
  readonly deleteCalls: string[][] = [];
  private counter = 0;
  /** List fields by item id, and the audit log the Activity tab shows (written by this source, as the database would). */
  related = new Map<string, RelatedValues>();
  activity: ActivityRow[] = [];
  /** Who the writes are attributed to in `activity`. */
  actorId: string | null = "u1";
  private auditSeq = 0;
  private clock = 0;
  private audit(entity: string, entityId: string, field: string, old: unknown, value: unknown, tick = true) {
    if (tick) this.clock++;
    this.activity.unshift({ id: ++this.auditSeq, at: new Date(Date.UTC(2027, 3, 14, 10, 0, this.clock)).toISOString(), entity, entityId, field, old: old ?? null, new: value ?? null, actorId: this.actorId, via: "UI" });
  }
  /** The audit rows the database writes for one added or removed row of a list field. */
  private auditListRow(field: RelatedField, itemId: string, x: unknown, added: boolean) {
    const tagKind: Partial<Record<RelatedField, string>> = { tags: "tag", target_scope: "target_scope", live_scope: "live_scope", target_segments: "segment" };
    const rowId = `${field}-${++this.auditSeq}`;
    const cols: [string, string, unknown][] =
      tagKind[field] ? [["item_tags", "kind", tagKind[field]], ["item_tags", "value", x]]
      : field === "artifacts" ? [["item_links", "label", (x as { label: string }).label], ["item_links", "url", (x as { url: string }).url]]
      : field === "contributing_teams" ? [["item_teams", "team_id", x]]
      : [["item_relations", "kind", field], ["item_relations", "related_item_id", x]];
    const entity = cols[0]![0];
    this.clock++;
    const put = (f: string, v: unknown) => (added ? this.audit(entity, rowId, f, null, v, false) : this.audit(entity, rowId, f, v, null, false));
    put("id", rowId); put("item_id", itemId);
    for (const [, f, v] of cols) put(f, v);
  }

  constructor(items: LoadedItem[], opts: { latencyMs?: number } = {}) {
    this.items = items.map((i) => ({ ...i }));
    this.latencyMs = opts.latencyMs ?? 0;
  }

  private async pause() { if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs)); }

  async loadItems() { await this.pause(); return this.items.map((i) => ({ ...i })).sort((a, b) => a.stack_rank - b.stack_rank); }

  async updateField(itemId: string, field: EditableField, value: unknown, opts: { expected?: unknown } = {}): Promise<SaveResult> {
    const op: Op = { type: "update", itemId, field, value, ...("expected" in opts ? { expected: opts.expected } : {}) };
    this.calls.push(op);
    await this.pause();
    const fail = this.failWhen?.(op);
    if (fail) return { ok: false, error: fail };
    const row = this.items.find((i) => i.id === itemId);
    if (!row) return { ok: false, error: "The item no longer exists or you cannot edit it." };
    if ("expected" in opts && (row as Record<string, unknown>)[field] !== opts.expected && !((row as Record<string, unknown>)[field] == null && opts.expected == null)) {
      return { ok: false, error: "It was changed by someone else.", conflict: true };
    }
    this.audit("items", itemId, columnOnItems(FIELD_BY_KEY[field]!) ?? field, (row as Record<string, unknown>)[field], value);
    (row as Record<string, unknown>)[field] = value;
    return { ok: true };
  }

  async loadRelated(itemId: string): Promise<RelatedValues> {
    await this.pause();
    return structuredClone(this.related.get(itemId) ?? emptyRelated());
  }
  /** Return an error message to make setRelated fail. */
  failRelated: string | null = null;
  readonly relatedCalls: { itemId: string; field: RelatedField; value: unknown[] }[] = [];
  async setRelated(itemId: string, field: RelatedField, value: unknown[]): Promise<SaveResult> {
    this.relatedCalls.push({ itemId, field, value: structuredClone(value) });
    await this.pause();
    if (this.failRelated) return { ok: false, error: this.failRelated };
    const cur = this.related.get(itemId) ?? emptyRelated();
    const before = new Set((cur[field] as unknown[]).map((x) => JSON.stringify(x)));
    const after = new Set(value.map((x) => JSON.stringify(x)));
    for (const x of value) if (!before.has(JSON.stringify(x))) this.auditListRow(field, itemId, x, true);
    for (const x of cur[field] as unknown[]) if (!after.has(JSON.stringify(x))) this.auditListRow(field, itemId, x, false);
    (cur as Record<string, unknown[]>)[field] = structuredClone(value);
    this.related.set(itemId, cur);
    return { ok: true };
  }
  async loadActivity(itemId: string): Promise<ActivityRow[]> {
    await this.pause();
    // related rows are kept for the item that wrote them (their item_id audit row says which)
    const mine = new Set(this.activity.filter((a) => a.field === "item_id" && a.entity !== "items" && (a.new === itemId || a.old === itemId)).map((a) => a.entityId));
    return this.activity.filter((a) => (a.entity === "items" ? a.entityId === itemId : mine.has(a.entityId))).map((a) => ({ ...a }));
  }

  async createMany(items: NewItem[], opts: { via?: "import" } = {}): Promise<CreateManyResult> {
    this.createCalls.push({ count: items.length, ...(opts.via ? { via: opts.via } : {}) });
    await this.pause();
    if (this.failCreate) return { ok: false, error: this.failCreate };
    const out: { id: string; item_code: string; stack_rank: number }[] = [];
    for (const item of items) {
      const max = this.items.reduce((n, i) => Math.max(n, i.stack_rank), 0);
      this.counter = Math.max(this.counter, this.items.length) + 1;
      const code = `R-${String(this.counter).padStart(2, "0")}`;
      this.items.push({ ...item, item_code: code, stack_rank: max + 1 } as LoadedItem);
      out.push({ id: item.id, item_code: code, stack_rank: max + 1 });
    }
    return { ok: true, items: out };
  }

  async deleteItems(itemIds: string[]): Promise<SaveResult> {
    this.deleteCalls.push([...itemIds]);
    await this.pause();
    if (itemIds.some((id) => !this.items.some((i) => i.id === id))) return { ok: false, error: "An item no longer exists or you cannot delete it." };
    this.items = this.items.filter((i) => !itemIds.includes(i.id)).sort((a, b) => a.stack_rank - b.stack_rank).map((i, n) => ({ ...i, stack_rank: n + 1 }));
    return { ok: true };
  }

  async moveItem(itemId: string, to: number): Promise<SaveResult> {
    const op: Op = { type: "move", itemId, to };
    this.calls.push(op);
    await this.pause();
    const fail = this.failWhen?.(op);
    if (fail) return { ok: false, error: fail };
    const r = applyMove(this.items as LoadedItem[], itemId, to);
    this.items = r.items;
    return { ok: true };
  }
}

/** Plausible rows for tests and the test page. */
export function sampleItems(n: number, projects: string[], people: string[]): LoadedItem[] {
  const moscow = ["Must", "Should", "Could", "Won't"];
  const effort = ["XS", "S", "M", "L", "XL"];
  const health = ["On Track", "At Risk", "Delayed"];
  const confidence = ["High", "Medium", "Low"];
  const status = ["Backlog", "In Progress", "Completed"];
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i + 1}`,
    item_code: `R-${String(i + 1).padStart(2, "0")}`,
    initiative_name: `Initiative number ${i + 1} with a reasonably long title`,
    stack_rank: i + 1,
    home_project: projects[i % projects.length]!,
    product_manager: i % 7 === 0 ? null : people[i % people.length]!,
    moscow: moscow[i % 4]!,
    effort: effort[i % 5]!,
    health: health[i % 3]!,
    value_12m: i % 5 === 0 ? null : ((i * 37) % 100) * 1000,
    confidence: confidence[i % 3]!,
    start_date: "2027-01-04",
    g2m_date_est: "2027-03-31",
    status: status[i % 3]!,
    delivery_progress_pct: (i * 7) % 100,
    value_weighted: i % 5 === 0 ? null : ((i * 37) % 100) * 600,
    tags: i % 4 === 0 ? "priority, q1" : null,
  }));
}
