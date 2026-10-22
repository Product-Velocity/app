import { applyMove, type EditableField } from "@pv/domain";
import type { PortfolioDataSource, SaveResult } from "./data-source";
import type { LoadedItem } from "./types";

export type Op = { type: "update"; itemId: string; field: string; value: unknown; expected?: unknown } | { type: "move"; itemId: string; to: number };

/** In-memory data source for tests and the test page. Can be slow or fail on demand. */
export class MemoryDataSource implements PortfolioDataSource {
  readonly calls: Op[] = [];
  items: LoadedItem[];
  latencyMs = 0;
  /** Return an error message to make that operation fail. */
  failWhen: ((op: Op) => string | null) | null = null;

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
    (row as Record<string, unknown>)[field] = value;
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
