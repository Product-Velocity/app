import { applyMove, type EditableField } from "@pv/domain";
import type { PortfolioDataSource, SaveResult } from "./data-source";
import type { GridItem } from "./types";

export type Op = { type: "update"; itemId: string; field: string; value: unknown; expected?: unknown } | { type: "move"; itemId: string; to: number };

/** In-memory data source for tests and the test page. Can be slow or fail on demand. */
export class MemoryDataSource implements PortfolioDataSource {
  readonly calls: Op[] = [];
  items: Omit<GridItem, "project_rank">[];
  latencyMs = 0;
  /** Return an error message to make that operation fail. */
  failWhen: ((op: Op) => string | null) | null = null;

  constructor(items: Omit<GridItem, "project_rank">[], opts: { latencyMs?: number } = {}) {
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
    const r = applyMove(this.items as (Omit<GridItem, "project_rank"> & { home_project_id: string })[], itemId, to);
    this.items = r.items;
    return { ok: true };
  }
}

/** Plausible rows for tests and the test page. */
export function sampleItems(n: number, projects: string[], people: string[]): Omit<GridItem, "project_rank">[] {
  const moscow = ["must", "should", "could", "wont"] as const;
  const size = ["XS", "S", "M", "L", "XL"] as const;
  const health = ["on_track", "at_risk", "delayed"] as const;
  const status = ["Open", "In progress", "Done"];
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i + 1}`,
    key: `R-${String(i + 1).padStart(2, "0")}`,
    title: `Initiative number ${i + 1} with a reasonably long title`,
    stack_rank: i + 1,
    home_project_id: projects[i % projects.length]!,
    owner_user_id: i % 7 === 0 ? null : people[i % people.length]!,
    moscow: moscow[i % 4]!,
    size: size[i % 5]!,
    health: health[i % 3]!,
    value: i % 5 === 0 ? null : ((i * 37) % 100) * 1000,
    confidence: (i * 13) % 100,
    start_date: "2027-01-04",
    end_date: "2027-03-31",
    status: status[i % 3]!,
    delivery_progress: (i * 7) % 100,
  }));
}
