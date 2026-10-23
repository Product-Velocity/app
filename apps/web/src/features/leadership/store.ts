import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditChange } from "@pv/domain";

export type WeeklyUpdate = { id: string; weekStart: string; scopeKey: string; scopeLabel: string; body: string; reviewedAt: string | null; reviewedBy: string | null };
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** What the leadership page reads and writes beyond the items: the week's audit changes and the weekly update. */
export interface LeadershipStore {
  /** Rank, status and health changes since a time (audit log, readable by every member). */
  loadChanges(sinceIso: string): Promise<AuditChange[]>;
  getUpdate(weekStart: string, scopeKey: string): Promise<WeeklyUpdate | null>;
  /** Create the update of that week and scope, or replace its text (which clears a review). Creators and admins only. */
  saveDraft(weekStart: string, scopeKey: string, scopeLabel: string, body: string): Promise<Result<WeeklyUpdate>>;
  /** Creators and admins; the database records who and when. */
  markReviewed(id: string): Promise<Result<WeeklyUpdate>>;
}

type Row = { id: string; week_start: string; scope_key: string; scope_label: string; body: string; reviewed_at: string | null; reviewed_by: string | null };
const COLUMNS = "id,week_start,scope_key,scope_label,body,reviewed_at,reviewed_by";
const fromRow = (r: Row): WeeklyUpdate => ({ id: r.id, weekStart: r.week_start, scopeKey: r.scope_key, scopeLabel: r.scope_label, body: r.body, reviewedAt: r.reviewed_at, reviewedBy: r.reviewed_by });

type DbError = { code?: string; message?: string } | null;
function friendly(e: DbError, what: string): string {
  if (!e) return `Could not ${what}.`;
  if (e.code === "42501") return "You can read the weekly update but only creators and admins can change it.";
  if (e.code === "23514") return "The text must be between 1 and 20,000 characters.";
  if (e.code === "PV004") return "Claude cannot mark an update as reviewed.";
  return `Could not ${what}. Try again.`;
}

export class SupabaseLeadershipStore implements LeadershipStore {
  constructor(private readonly client: SupabaseClient, private readonly tenantId: string) {}

  async loadChanges(sinceIso: string): Promise<AuditChange[]> {
    const { data, error } = await this.client.rpc("weekly_item_changes", { p_tenant: this.tenantId, p_since: sinceIso });
    if (error) throw new Error(friendly(error, "load this week's changes"));
    return ((data ?? []) as { item_id: string; field: string; old: unknown; new: unknown; at: string; actor_id: string | null; via: string }[])
      .map((r) => ({ itemId: r.item_id, field: r.field, old: r.old, new: r.new, at: r.at, actorId: r.actor_id, via: r.via }));
  }

  async getUpdate(weekStart: string, scopeKey: string): Promise<WeeklyUpdate | null> {
    const { data, error } = await this.client.from("weekly_updates").select(COLUMNS).eq("tenant_id", this.tenantId).eq("week_start", weekStart).eq("scope_key", scopeKey).maybeSingle();
    if (error) throw new Error(friendly(error, "load the weekly update"));
    return data ? fromRow(data as Row) : null;
  }

  async saveDraft(weekStart: string, scopeKey: string, scopeLabel: string, body: string): Promise<Result<WeeklyUpdate>> {
    const existing = await this.client.from("weekly_updates").select("id").eq("tenant_id", this.tenantId).eq("week_start", weekStart).eq("scope_key", scopeKey).maybeSingle();
    if (existing.error) return { ok: false, error: friendly(existing.error, "save the weekly update") };
    const { data, error } = existing.data
      ? await this.client.from("weekly_updates").update({ body, scope_label: scopeLabel }).eq("tenant_id", this.tenantId).eq("id", existing.data.id).select(COLUMNS)
      : await this.client.from("weekly_updates").insert({ tenant_id: this.tenantId, week_start: weekStart, scope_key: scopeKey, scope_label: scopeLabel, body }).select(COLUMNS);
    const r = (data as Row[] | null)?.[0];
    return error || !r ? { ok: false, error: error ? friendly(error, "save the weekly update") : friendly({ code: "42501" }, "save") } : { ok: true, value: fromRow(r) };
  }

  async markReviewed(id: string): Promise<Result<WeeklyUpdate>> {
    const { data, error } = await this.client.from("weekly_updates").update({ reviewed_at: new Date().toISOString() }).eq("tenant_id", this.tenantId).eq("id", id).select(COLUMNS);
    const r = (data as Row[] | null)?.[0];
    return error || !r ? { ok: false, error: error ? friendly(error, "mark the update as reviewed") : friendly({ code: "42501" }, "mark") } : { ok: true, value: fromRow(r) };
  }
}

/** In-memory store for tests and the test page. */
export class MemoryLeadershipStore implements LeadershipStore {
  changes: AuditChange[];
  updates: WeeklyUpdate[] = [];
  writable = true;
  /** Who reviews (the database uses the signed-in user). */
  me = "u1";
  failWith: string | null = null;
  private n = 0;
  constructor(changes: AuditChange[] = []) { this.changes = changes; }
  async loadChanges(since: string) { return this.changes.filter((c) => c.at >= since).map((c) => ({ ...c })); }
  async getUpdate(weekStart: string, scopeKey: string) { const u = this.updates.find((x) => x.weekStart === weekStart && x.scopeKey === scopeKey); return u ? { ...u } : null; }
  async saveDraft(weekStart: string, scopeKey: string, scopeLabel: string, body: string): Promise<Result<WeeklyUpdate>> {
    if (this.failWith) return { ok: false, error: this.failWith };
    if (!this.writable) return { ok: false, error: friendly({ code: "42501" }, "save") };
    if (body.length < 1 || body.length > 20000) return { ok: false, error: friendly({ code: "23514" }, "save") };
    let u = this.updates.find((x) => x.weekStart === weekStart && x.scopeKey === scopeKey);
    if (u) { if (u.body !== body) { u.body = body; u.reviewedAt = null; u.reviewedBy = null; } u.scopeLabel = scopeLabel; }
    else { u = { id: `wu${++this.n}`, weekStart, scopeKey, scopeLabel, body, reviewedAt: null, reviewedBy: null }; this.updates.push(u); }
    return { ok: true, value: { ...u } };
  }
  async markReviewed(id: string): Promise<Result<WeeklyUpdate>> {
    if (this.failWith) return { ok: false, error: this.failWith };
    const u = this.updates.find((x) => x.id === id);
    if (!this.writable || !u) return { ok: false, error: friendly({ code: "42501" }, "mark") };
    u.reviewedAt = "2027-04-14T09:00:00.000Z"; u.reviewedBy = this.me;
    return { ok: true, value: { ...u } };
  }
}
