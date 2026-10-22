import type { SupabaseClient } from "@supabase/supabase-js";
import { FIELDS, FIELD_BY_KEY, KEY_BY_COLUMN, columnOnItems, type EditableField } from "@pv/domain";
import type { CreateResult, NewItem, PortfolioDataSource, SaveResult } from "./data-source";
import type { LoadedItem } from "./types";

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

const NUMERIC = new Set(FIELDS.filter((f) => f.type === "Number" || f.type === "Currency" || f.type === "Computed").map((f) => f.key));
/** Computed values come from the items_computed view; the browser works out project_rank itself after a re-rank. */
const COMPUTED_KEYS = FIELDS.filter((f) => f.storage.startsWith("Computed") && f.key !== "project_rank").map((f) => f.key);
const INTERNAL_COLUMNS = new Set(["tenant_id", "cycle_id", "created_by", "updated_at", "last_edited_by", "github_issue_url", "last_synced_at", "created_via", "effort_by_skill"]);

const dbColumn = (field: string) => {
  const f = FIELD_BY_KEY[field];
  return (f && columnOnItems(f)) ?? field;
};

export class SupabaseDataSource implements PortfolioDataSource {
  constructor(private readonly client: SupabaseClient, private readonly tenantId: string) {}

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
    for (const r of rows) {
      const item: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (INTERNAL_COLUMNS.has(k)) continue;
        item[KEY_BY_COLUMN[k] ?? k] = NUMERIC.has(k) && v !== null && v !== undefined ? Number(v) : v;
      }
      items.set(String(r.id), item);
    }

    // calculated fields (view items_computed)
    const computed = await this.fetchAll<Record<string, unknown>>("items_computed", ["id", ...COMPUTED_KEYS].join(","));
    for (const c of computed) {
      const item = items.get(String(c.id));
      if (!item) continue;
      for (const k of COMPUTED_KEYS) item[k] = c[k] === null || c[k] === undefined ? null : typeof c[k] === "string" && NUMERIC.has(k) ? Number(c[k]) : c[k];
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

    for (const [id, item] of items) {
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

  async createItem(item: NewItem): Promise<CreateResult> {
    const { data, error } = await this.client
      .from("items")
      .insert({
        id: item.id, tenant_id: this.tenantId, initiative_name: item.initiative_name, home_project_id: item.home_project,
        owner_user_id: item.product_manager, effort: item.effort, moscow: item.moscow,
      })
      .select("item_code,stack_rank")
      .single();
    if (error || !data) return { ok: false, error: friendlyError(error) };
    return { ok: true, item_code: String(data.item_code), stack_rank: Number(data.stack_rank) };
  }

  async deleteItem(itemId: string): Promise<SaveResult> {
    const { data, error } = await this.client.from("items").delete().eq("tenant_id", this.tenantId).eq("id", itemId).select("id");
    if (error) return { ok: false, error: friendlyError(error) };
    return data && data.length > 0 ? { ok: true } : { ok: false, error: "the item was already removed or you cannot delete it" };
  }

  async moveItem(itemId: string, toRank: number): Promise<SaveResult> {
    const { error } = await this.client.rpc("move_item", { p_item: itemId, p_new_rank: toRank });
    return error ? { ok: false, error: friendlyError(error) } : { ok: true };
  }
}
