import type { SupabaseClient } from "@supabase/supabase-js";
import { FIELDS, FIELD_BY_KEY, KEY_BY_COLUMN, columnOnItems, emptyRelated, lastSyncedAt, syncedWith, type SyncLink, type ActivityRow, type EditableField, type Link, type RelatedField, type RelatedValues } from "@pv/domain";
import type { BatchResult, CreateManyResult, NewItem, PortfolioDataSource, RestoreResult, SaveResult } from "./data-source";
import type { IssueTreeRow, LoadedItem, TrashedItem } from "./types";

/** Supabase returns at most 1,000 rows per request, so a 2,000-item workspace needs several pages. */
export const PAGE_SIZE = 1000;

type DbError = { code?: string; message?: string } | null;

export function friendlyError(error: DbError): string {
  switch (error?.code) {
    case "42501": return "you do not have permission to change this";
    case "23514": return "that value is not allowed";
    case "23503": return "that project or person does not exist in this workspace";
    case "PV004": return "Claude and service accounts cannot set rank, value or decision";
  }
  const m = error?.message ?? "";
  if (/failed to fetch|network|load failed/i.test(m)) return "could not reach the server, check your connection";
  return m || "unknown error";
}

/** Postgres returns numeric columns as strings. Only a string that is a number becomes one: a GitHub-driven column of type "Computed" can hold words (Delivery Status "Done", GitHub State "Open"). */
const asNumber = (v: unknown) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
const NUMERIC = new Set(FIELDS.filter((f) => f.type === "Number" || f.type === "Currency" || f.type === "Computed").map((f) => f.key));
/** Computed values come from the items_computed view; the browser works out project_rank itself after a re-rank. */
const COMPUTED_KEYS = FIELDS.filter((f) => f.storage.startsWith("Computed") && f.key !== "project_rank").map((f) => f.key); // "Derived in the app" fields are not in the view
const INTERNAL_COLUMNS = new Set(["tenant_id", "cycle_id", "created_by", "updated_at", "last_edited_by", "github_issue_url", "last_synced_at", "created_via", "deleted_at", "deleted_by"]);

const dbColumn = (field: string) => {
  const f = FIELD_BY_KEY[field];
  return (f && columnOnItems(f)) ?? field;
};

export class SupabaseDataSource implements PortfolioDataSource {
  /** `importClient` sends the header that labels writes as "import" in the audit log. */
  constructor(private readonly client: SupabaseClient, private readonly tenantId: string, private readonly importClient: SupabaseClient = client) {}

  /** Every row of a table or view for this tenant, page by page. */
  private async fetchAll<T>(table: string, columns: string, order: string[] = ["id"], onlyDefaultCycle = false): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let q = this.client.from(table).select(columns).eq("tenant_id", this.tenantId); // always filter by tenant (index + fast policy, spike S7)
      if (onlyDefaultCycle) q = q.is("cycle_id", null);
      for (const o of order) q = q.order(o, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(friendlyError(error));
      out.push(...((data ?? []) as unknown as T[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return out;
  }

  async loadItems(): Promise<LoadedItem[]> {
    const rows = await this.fetchAll<Record<string, unknown>>("items", "*", ["stack_rank", "id"], true);
    const items = new Map<string, Record<string, unknown>>();
    const syncMark = new Map<string, string | null>(); // items.last_synced_at: set when GitHub's changes were applied to the item
    for (const r of rows) {
      syncMark.set(String(r.id), (r.last_synced_at as string | null) ?? null);
      const item: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (INTERNAL_COLUMNS.has(k)) continue;
        item[KEY_BY_COLUMN[k] ?? k] = NUMERIC.has(k) && v !== null && v !== undefined ? asNumber(v) : v;
      }
      item._created_by = r.created_by ?? null; // who added it: decides who may delete it (not a grid column)
      items.set(String(r.id), item);
    }

    // calculated fields (view items_computed)
    const computed = await this.fetchAll<Record<string, unknown>>("items_computed", ["id", ...COMPUTED_KEYS].join(","));
    for (const c of computed) {
      const item = items.get(String(c.id));
      if (!item) continue;
      for (const k of COMPUTED_KEYS) item[k] = c[k] === null || c[k] === undefined ? null : NUMERIC.has(k) ? asNumber(c[k]) : c[k];
    }

    // multi-value fields from the related tables, shown as text until the item panel exists
    const code = (id: unknown) => String((items.get(String(id)) ?? {}).item_code ?? "");
    const add = (map: Map<string, string[]>, id: unknown, text: string) => {
      const k = String(id);
      map.set(k, [...(map.get(k) ?? []), text]);
    };
    const tags = new Map<string, Map<string, string[]>>();
    for (const t of await this.fetchAll<{ item_id: string; kind: string; value: string }>("item_tags", "item_id,kind,value", ["item_id", "value"])) {
      if (!tags.has(t.kind)) tags.set(t.kind, new Map());
      add(tags.get(t.kind)!, t.item_id, t.value);
    }
    const links = new Map<string, string[]>();
    for (const l of await this.fetchAll<{ item_id: string; label: string; url: string }>("item_links", "item_id,label,url")) add(links, l.item_id, l.label ? `${l.label} (${l.url})` : l.url);
    const files = new Map<string, string[]>();
    for (const f of await this.fetchAll<{ item_id: string; name: string }>("item_files", "item_id,name")) add(files, f.item_id, f.name);
    const rel = { depends_on: new Map<string, string[]>(), related_to: new Map<string, string[]>() };
    for (const r of await this.fetchAll<{ item_id: string; related_item_id: string; kind: "depends_on" | "related_to" }>("item_relations", "item_id,related_item_id,kind")) add(rel[r.kind], r.item_id, code(r.related_item_id));
    const teamNames = new Map<string, string>();
    for (const t of await this.fetchAll<{ id: string; name: string }>("teams", "id,name")) teamNames.set(t.id, t.name);
    const teams = new Map<string, string[]>();
    for (const t of await this.fetchAll<{ item_id: string; team_id: string }>("item_teams", "item_id,team_id")) add(teams, t.item_id, teamNames.get(t.team_id) ?? "unknown team");

    // Last Synced and Synced With: derived from the GitHub link of each initiative
    const syncLinks = new Map<string, SyncLink>();
    for (const l of await this.fetchAll<{ item_id: string; mode: "push" | "follow"; repo_full_name: string; issue_number: number | null; sync_state: "pending" | "synced" | "error"; last_pushed_at: string | null; gh_synced_at: string | null; project_item_id: string | null }>("item_github_links", "item_id,mode,repo_full_name,issue_number,sync_state,last_pushed_at,gh_synced_at,project_item_id", ["item_id"])) {
      syncLinks.set(l.item_id, { mode: l.mode, repo: l.repo_full_name, issueNumber: l.issue_number, syncState: l.sync_state, lastPushedAt: l.last_pushed_at, ghSyncedAt: l.gh_synced_at, hasBoardItem: Boolean(l.project_item_id) });
    }
    const boardTitle = new Map<string, string>();
    if (syncLinks.size > 0) for (const p of await this.fetchAll<{ id: string; github_board: { title?: unknown } | null }>("projects", "id,github_board")) if (typeof p.github_board?.title === "string") boardTitle.set(p.id, p.github_board.title);

    for (const [id, item] of items) {
      const sl = syncLinks.get(id);
      item.last_synced = lastSyncedAt(sl, syncMark.get(id) ?? null);
      item.synced_with = syncedWith(sl, boardTitle.get(String(item.home_project)) ?? null) || null;
      item.tags = (tags.get("tag")?.get(id) ?? []).join(", ") || null;
      item.target_scope = (tags.get("target_scope")?.get(id) ?? []).join(", ") || null;
      item.live_scope = (tags.get("live_scope")?.get(id) ?? []).join(", ") || null;
      item.target_segments = (tags.get("segment")?.get(id) ?? []).join(", ") || null;
      item.artifacts = (links.get(id) ?? []).join("; ") || null;
      item.screenshots = (files.get(id) ?? []).join(", ") || null;
      item.depends_on = (rel.depends_on.get(id) ?? []).join("; ") || null;
      item.related_to = (rel.related_to.get(id) ?? []).join("; ") || null;
      item.contributing_teams = (teams.get(id) ?? []).join(", ") || null;
    }
    return [...items.values()] as unknown as LoadedItem[];
  }

  async updateField(itemId: string, field: EditableField, value: unknown, opts: { expected?: unknown } = {}): Promise<SaveResult> {
    const column = dbColumn(field);
    const guarded = "expected" in opts;
    let q = this.client.from("items").update({ [column]: value }).eq("tenant_id", this.tenantId).eq("id", itemId);
    if (guarded) q = opts.expected === null || opts.expected === undefined ? q.is(column, null) : q.eq(column, opts.expected as never);
    const { data, error } = await q.select("id");
    if (error) return { ok: false, error: friendlyError(error) };
    if (!data || data.length === 0) {
      return guarded
        ? { ok: false, error: "it was changed by someone else in the meantime", conflict: true }
        : { ok: false, error: "the item was removed or you cannot edit it" };
    }
    return { ok: true };
  }

  async createMany(items: NewItem[], opts: { via?: "import" } = {}): Promise<CreateManyResult> {
    const rows = items.map((item) => {
      const row: Record<string, unknown> = { tenant_id: this.tenantId };
      for (const [k, v] of Object.entries(item)) row[k === "id" ? "id" : dbColumn(k)] = v;
      return row;
    });
    const client = opts.via === "import" ? this.importClient : this.client;
    const { data, error } = await client.from("items").insert(rows).select("id,item_code,stack_rank");
    if (error || !data) return { ok: false, error: friendlyError(error) };
    return { ok: true, items: data.map((r) => ({ id: String(r.id), item_code: String(r.item_code), stack_rank: Number(r.stack_rank) })) };
  }

  private async batch(fn: string, itemIds: string[]): Promise<{ ok: true; rows: { id: string; ok: boolean; reason: string | null; stack_rank?: number }[] } | { ok: false; error: string }> {
    const { data, error } = await this.client.rpc(fn, { p_ids: itemIds });
    if (error) return { ok: false, error: friendlyError(error) };
    return { ok: true, rows: (data ?? []) as { id: string; ok: boolean; reason: string | null; stack_rank?: number }[] };
  }
  private failedOf = (rows: { id: string; ok: boolean; reason: string | null }[]) => rows.filter((r) => !r.ok).map((r) => ({ id: r.id, reason: r.reason ?? "unknown reason" }));

  async trashItems(itemIds: string[]): Promise<BatchResult> {
    const r = await this.batch("delete_items", itemIds);
    return r.ok ? { ok: true, failed: this.failedOf(r.rows) } : r;
  }
  async restoreItems(itemIds: string[]): Promise<RestoreResult> {
    const r = await this.batch("restore_items", itemIds);
    return r.ok ? { ok: true, restored: r.rows.filter((x) => x.ok).map((x) => ({ id: x.id, stack_rank: Number(x.stack_rank) })), failed: this.failedOf(r.rows) } : r;
  }
  async purgeItems(itemIds: string[]): Promise<BatchResult> {
    const r = await this.batch("purge_items", itemIds);
    return r.ok ? { ok: true, failed: this.failedOf(r.rows) } : r;
  }
  async loadTrash(): Promise<TrashedItem[]> {
    const { data, error } = await this.client.rpc("trashed_items", { p_tenant: this.tenantId });
    if (error) throw new Error(friendlyError(error));
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id), item_code: String(r.item_code), initiative_name: String(r.initiative_name), home_project: String(r.home_project_id),
      theme: (r.theme as string | null) ?? null, stack_rank: Number(r.stack_rank), created_by: (r.created_by as string | null) ?? null,
      deleted_at: String(r.deleted_at), deleted_by: (r.deleted_by as string | null) ?? null,
    }));
  }

  async deleteItems(itemIds: string[]): Promise<SaveResult> {
    const r = await this.batch("discard_new_items", itemIds);
    if (!r.ok) return r;
    const bad = r.rows.find((x) => !x.ok);
    return bad ? { ok: false, error: bad.reason ?? "an item was already removed or you cannot delete it" } : { ok: true };
  }

  async moveItem(itemId: string, toRank: number): Promise<SaveResult> {
    const { error } = await this.client.rpc("move_item", { p_item: itemId, p_new_rank: toRank });
    return error ? { ok: false, error: friendlyError(error) } : { ok: true };
  }

  // ------------------------------------------------------------ list fields of one item (item panel)
  async loadRelated(itemId: string): Promise<RelatedValues> {
    const mine = (table: string, columns: string) => this.client.from(table).select(columns).eq("tenant_id", this.tenantId).eq("item_id", itemId);
    const [tags, links, rels, teams] = await Promise.all([
      mine("item_tags", "kind,value").order("value"),
      mine("item_links", "label,url").order("created_at"),
      mine("item_relations", "related_item_id,kind"),
      mine("item_teams", "team_id"),
    ]);
    for (const r of [tags, links, rels, teams]) if (r.error) throw new Error(friendlyError(r.error));
    const out = emptyRelated();
    const TAG_FIELD: Record<string, RelatedField> = { tag: "tags", target_scope: "target_scope", live_scope: "live_scope", segment: "target_segments" };
    for (const t of (tags.data ?? []) as unknown as { kind: string; value: string }[]) { const f = TAG_FIELD[t.kind]; if (f) (out[f] as string[]).push(t.value); }
    out.artifacts = ((links.data ?? []) as unknown as Link[]).map((l) => ({ label: l.label ?? "", url: l.url }));
    for (const r of (rels.data ?? []) as unknown as { related_item_id: string; kind: "depends_on" | "related_to" }[]) out[r.kind].push(r.related_item_id);
    out.contributing_teams = ((teams.data ?? []) as unknown as { team_id: string }[]).map((t) => t.team_id);
    return out;
  }

  async setRelated(itemId: string, field: RelatedField, value: unknown[]): Promise<SaveResult> {
    const kinds: Partial<Record<RelatedField, string>> = { tags: "tag", target_scope: "target_scope", live_scope: "live_scope", target_segments: "segment" };
    const base = { tenant_id: this.tenantId, item_id: itemId };
    const run = async (table: string, columns: string, filter: Record<string, string>, same: (row: Record<string, unknown>, v: unknown) => boolean, toRow: (v: unknown) => Record<string, unknown>): Promise<SaveResult> => {
      let q = this.client.from(table).select(columns).eq("tenant_id", this.tenantId).eq("item_id", itemId);
      for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
      const cur = await q;
      if (cur.error) return { ok: false, error: friendlyError(cur.error) };
      const rows = (cur.data ?? []) as unknown as Record<string, unknown>[];
      const gone = rows.filter((r) => !value.some((v) => same(r, v)));
      const fresh = value.filter((v) => !rows.some((r) => same(r, v)));
      if (gone.length > 0) {
        const d = await this.client.from(table).delete().eq("tenant_id", this.tenantId).in("id", gone.map((r) => String(r.id)));
        if (d.error) return { ok: false, error: friendlyError(d.error) };
      }
      if (fresh.length > 0) {
        const i = await this.client.from(table).insert(fresh.map((v) => ({ ...base, ...filter, ...toRow(v) })));
        if (i.error) return { ok: false, error: friendlyError(i.error) };
      }
      return { ok: true };
    };
    if (kinds[field]) {
      const kind = kinds[field]!;
      return run("item_tags", "id,value", { kind }, (r, v) => String(r.value).toLowerCase() === String(v).toLowerCase(), (v) => ({ value: String(v) }));
    }
    if (field === "artifacts") {
      return run("item_links", "id,label,url", {}, (r, v) => r.url === (v as Link).url && (r.label ?? "") === (v as Link).label, (v) => ({ label: (v as Link).label, url: (v as Link).url }));
    }
    if (field === "depends_on" || field === "related_to") {
      return run("item_relations", "id,related_item_id", { kind: field }, (r, v) => r.related_item_id === v, (v) => ({ related_item_id: String(v) }));
    }
    return run("item_teams", "id,team_id", {}, (r, v) => r.team_id === v, (v) => ({ team_id: String(v) }));
  }

  async loadActivity(itemId: string): Promise<ActivityRow[]> {
    const { data, error } = await this.client.rpc("item_activity", { p_item: itemId });
    if (error) throw new Error(friendlyError(error));
    return ((data ?? []) as { id: string | number; at: string; entity: string; entity_id: string; field: string; old: unknown; new: unknown; actor_id: string | null; via: string }[])
      .map((r) => ({ id: Number(r.id), at: r.at, entity: r.entity, entityId: r.entity_id, field: r.field, old: r.old, new: r.new, actorId: r.actor_id, via: r.via }));
  }

  async copyToProject(itemIds: string[], projectId: string) {
    const { data, error } = await this.client.rpc("copy_items_to_project", { p_ids: itemIds, p_project: projectId });
    if (error) return { ok: false as const, error: friendlyError(error) };
    const rows = (data ?? []) as { id: string; ok: boolean; reason: string | null; new_id: string | null; new_code: string | null }[];
    return { ok: true as const, copied: rows.filter((r) => r.ok && r.new_id).map((r) => ({ id: r.new_id!, code: r.new_code ?? "" })), failed: rows.filter((r) => !r.ok).map((r) => ({ id: r.id, reason: r.reason ?? "unknown reason" })) };
  }

  async loadIssueTree(itemId: string): Promise<IssueTreeRow[]> {
    const { data, error } = await this.client.from("item_issue_tree").select("repo_full_name, issue_number, parent_number, level, title, state, state_reason, assignees, created_by, updated_at")
      .eq("tenant_id", this.tenantId).eq("item_id", itemId).order("level").order("issue_number");
    if (error) throw new Error(friendlyError(error));
    return ((data ?? []) as { repo_full_name: string; issue_number: number; parent_number: number | null; level: number; title: string; state: string; state_reason: string | null; assignees: string[]; created_by: string; updated_at: string }[])
      .map((r) => ({ repo: r.repo_full_name, number: r.issue_number, parentNumber: r.parent_number, level: r.level === 2 ? 2 : 1, title: r.title, state: r.state === "closed" ? "closed" : "open", stateReason: r.state_reason, assignees: r.assignees ?? [], createdBy: r.created_by === "app" || r.created_by === "claude" ? r.created_by : "engineer", updatedAt: r.updated_at }));
  }

  async completeBreakdown(itemId: string): Promise<{ ok: true; values: Record<string, unknown> } | { ok: false; error: string }> {
    const { error } = await this.client.rpc("item_complete_breakdown", { p_item: itemId });
    if (error) return { ok: false, error: friendlyError(error) };
    const { data, error: e2 } = await this.client.from("items").select("breakdown_status, breakdown_route, planned_scope, scope_added").eq("tenant_id", this.tenantId).eq("id", itemId).single();
    if (e2) return { ok: false, error: friendlyError(e2) };
    return { ok: true, values: data as Record<string, unknown> };
  }
}
