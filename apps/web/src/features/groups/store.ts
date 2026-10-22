import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanGroupName } from "@pv/domain";

export type GroupUsage = { id: string; name: string; items: number };
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
/** What a merge changed, kept so it can be undone from the screen: the items that moved and the group they left. */
export type MergeReceipt = { from: string; into: string; itemIds: string[] };

/** The tidy-up of Initiative Groups. Admins only: the database refuses everyone else. */
export interface GroupsStore {
  list(): Promise<GroupUsage[]>;
  rename(id: string, name: string): Promise<Result<number>>;
  merge(fromId: string, intoId: string): Promise<Result<MergeReceipt>>;
  undoMerge(receipt: MergeReceipt): Promise<Result<number>>;
  retire(id: string): Promise<Result<null>>;
}

type DbError = { code?: string; message?: string } | null;
function friendly(e: DbError, what: string): string {
  if (!e) return `Could not ${what}.`;
  if (e.code === "23505") return "There is already a group with that name.";
  if (e.code === "42501") return "Only admins can change groups.";
  if (e.code === "23503" || e.code === "23514" || e.code === "P0001") return e.message ?? `Could not ${what}.`;
  return `Could not ${what}. Try again.`;
}

export class SupabaseGroupsStore implements GroupsStore {
  constructor(private readonly client: SupabaseClient, private readonly tenantId: string) {}

  async list(): Promise<GroupUsage[]> {
    const { data, error } = await this.client.rpc("item_group_usage", { p_tenant: this.tenantId });
    if (error) throw new Error(friendly(error, "load the groups"));
    return ((data ?? []) as { id: string; name: string; items: number | string }[]).map((r) => ({ id: r.id, name: r.name, items: Number(r.items) }));
  }
  async rename(id: string, name: string): Promise<Result<number>> {
    const c = cleanGroupName(name);
    if (!c.ok) return { ok: false, error: c.error };
    const { data, error } = await this.client.rpc("rename_item_group", { p_group: id, p_name: c.name });
    return error ? { ok: false, error: friendly(error, "rename the group") } : { ok: true, value: Number(data ?? 0) };
  }
  async merge(fromId: string, intoId: string): Promise<Result<MergeReceipt>> {
    const names = await this.list();
    const from = names.find((g) => g.id === fromId), into = names.find((g) => g.id === intoId);
    if (!from || !into) return { ok: false, error: "Those groups no longer exist." };
    const { data, error } = await this.client.rpc("merge_item_groups", { p_from: fromId, p_into: intoId });
    return error ? { ok: false, error: friendly(error, "merge the groups") } : { ok: true, value: { from: from.name, into: into.name, itemIds: (data ?? []) as string[] } };
  }
  async undoMerge(r: MergeReceipt): Promise<Result<number>> {
    const { data, error } = await this.client.rpc("restore_merged_group", { p_tenant: this.tenantId, p_name: r.from, p_into_name: r.into, p_items: r.itemIds });
    return error ? { ok: false, error: friendly(error, "undo the merge") } : { ok: true, value: Number(data ?? 0) };
  }
  async retire(id: string): Promise<Result<null>> {
    const { error } = await this.client.rpc("retire_item_group", { p_group: id });
    return error ? { ok: false, error: friendly(error, "retire the group") } : { ok: true, value: null };
  }
}

/** In-memory store for tests and the test page. */
export class MemoryGroupsStore implements GroupsStore {
  groups: GroupUsage[];
  /** Item ids by group name, so merges and undo move something. */
  members = new Map<string, string[]>();
  admin = true;
  private n = 0;
  constructor(groups: { name: string; items?: number }[] = []) {
    this.groups = groups.map((g) => ({ id: `g${++this.n}`, name: g.name, items: g.items ?? 0 }));
    for (const g of this.groups) this.members.set(g.name, Array.from({ length: g.items }, (_, i) => `${g.name}-${i}`));
  }
  private sync() { for (const g of this.groups) g.items = this.members.get(g.name)?.length ?? 0; }
  private denied<T>(): Result<T> | null { return this.admin ? null : { ok: false, error: "Only admins can change groups." }; }
  async list() { this.sync(); return this.groups.map((g) => ({ ...g })).sort((a, b) => a.name.localeCompare(b.name, "en")); }
  async rename(id: string, name: string): Promise<Result<number>> {
    const d = this.denied<number>(); if (d) return d;
    const c = cleanGroupName(name); if (!c.ok) return { ok: false, error: c.error };
    const g = this.groups.find((x) => x.id === id); if (!g) return { ok: false, error: "That group does not exist or you cannot change it." };
    if (this.groups.some((x) => x.id !== id && x.name.toLowerCase() === c.name.toLowerCase())) return { ok: false, error: "There is already a group with that name." };
    const ids = this.members.get(g.name) ?? [];
    this.members.delete(g.name); g.name = c.name; this.members.set(c.name, ids); this.sync();
    return { ok: true, value: ids.length };
  }
  async merge(fromId: string, intoId: string): Promise<Result<MergeReceipt>> {
    const d = this.denied<MergeReceipt>(); if (d) return d;
    const from = this.groups.find((x) => x.id === fromId), into = this.groups.find((x) => x.id === intoId);
    if (!from || !into || from.id === into.id) return { ok: false, error: "Choose two different groups." };
    const ids = this.members.get(from.name) ?? [];
    this.members.set(into.name, [...(this.members.get(into.name) ?? []), ...ids]);
    this.members.delete(from.name); this.groups = this.groups.filter((x) => x.id !== from.id); this.sync();
    return { ok: true, value: { from: from.name, into: into.name, itemIds: [...ids] } };
  }
  async undoMerge(r: MergeReceipt): Promise<Result<number>> {
    const d = this.denied<number>(); if (d) return d;
    this.groups.push({ id: `g${++this.n}`, name: r.from, items: 0 });
    const into = this.members.get(r.into) ?? [];
    this.members.set(r.into, into.filter((x) => !r.itemIds.includes(x)));
    this.members.set(r.from, r.itemIds.filter((x) => into.includes(x)));
    this.sync();
    return { ok: true, value: this.members.get(r.from)!.length };
  }
  async retire(id: string): Promise<Result<null>> {
    const d = this.denied<null>(); if (d) return d;
    const g = this.groups.find((x) => x.id === id); if (!g) return { ok: false, error: "That group does not exist or you cannot change it." };
    this.sync();
    if (g.items > 0) return { ok: false, error: "That group still has initiatives. Merge it into another group instead." };
    this.groups = this.groups.filter((x) => x.id !== id);
    return { ok: true, value: null };
  }
}
