import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditableField } from "@pv/domain";
import type { PortfolioDataSource, SaveResult } from "./data-source";
import type { GridItem } from "./types";

/** Supabase returns at most 1,000 rows per request, so a 2,000-item workspace needs several pages. */
export const PAGE_SIZE = 1000;
const COLUMNS =
  "id,key,title,stack_rank,home_project_id,owner_user_id,moscow,size,health,value,confidence,start_date,end_date,status,delivery_progress";

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

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export class SupabaseDataSource implements PortfolioDataSource {
  constructor(private readonly client: SupabaseClient, private readonly tenantId: string) {}

  async loadItems(): Promise<Omit<GridItem, "project_rank">[]> {
    const out: Omit<GridItem, "project_rank">[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await this.client
        .from("items")
        .select(COLUMNS)
        .eq("tenant_id", this.tenantId) // always filter by tenant (index + fast policy, spike S7)
        .is("cycle_id", null)
        .order("stack_rank", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(friendlyError(error));
      for (const r of data ?? []) {
        out.push({ ...(r as Omit<GridItem, "project_rank">), value: num(r.value), confidence: num(r.confidence), delivery_progress: num(r.delivery_progress) });
      }
      if (!data || data.length < PAGE_SIZE) break;
    }
    return out;
  }

  async updateField(itemId: string, field: EditableField, value: unknown, opts: { expected?: unknown } = {}): Promise<SaveResult> {
    const guarded = "expected" in opts;
    let q = this.client.from("items").update({ [field]: value }).eq("tenant_id", this.tenantId).eq("id", itemId);
    if (guarded) q = opts.expected === null || opts.expected === undefined ? q.is(field, null) : q.eq(field, opts.expected as never);
    const { data, error } = await q.select("id");
    if (error) return { ok: false, error: friendlyError(error) };
    if (!data || data.length === 0) {
      return guarded
        ? { ok: false, error: "it was changed by someone else in the meantime", conflict: true }
        : { ok: false, error: "the item was removed or you cannot edit it" };
    }
    return { ok: true };
  }

  async moveItem(itemId: string, toRank: number): Promise<SaveResult> {
    const { error } = await this.client.rpc("move_item", { p_item: itemId, p_new_rank: toRank });
    return error ? { ok: false, error: friendlyError(error) } : { ok: true };
  }
}
