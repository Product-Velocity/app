import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppNotification, ChangeCountRow } from "@pv/domain";

/** Where the bell reads and writes. Supabase in the app, memory in tests. Rows are written by the database; the app only reads them and marks them read. */
export interface NotificationSource {
  load(): Promise<AppNotification[]>;
  /** Marks the listed notifications read, or all of the person's own when no list is given. */
  markRead(ids?: string[]): Promise<void>;
}

export class SupabaseNotificationSource implements NotificationSource {
  constructor(private readonly client: SupabaseClient, private readonly tenantId: string) {}

  async load(): Promise<AppNotification[]> {
    const { data, error } = await this.client.from("notifications").select("id,kind,item_id,review_id,payload,created_at,read_at")
      .eq("tenant_id", this.tenantId).order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AppNotification[];
  }

  async markRead(ids?: string[]): Promise<void> {
    const { error } = await this.client.rpc("mark_notifications_read", { p_ids: ids ?? null });
    if (error) throw new Error(error.message);
  }
}

export class MemoryNotificationSource implements NotificationSource {
  calls: string[] = [];
  constructor(public list: AppNotification[] = []) {}
  async load() { return this.list.map((n) => ({ ...n })); }
  async markRead(ids?: string[]) {
    this.calls.push(`read ${ids ? ids.join(",") : "all"}`);
    for (const n of this.list) if (!n.read_at && (!ids || ids.includes(n.id))) n.read_at = "2027-04-14T12:00:00Z";
  }
}

/** Where the bell reads the change counters of every project in every account the person can open, and resets them. */
export interface ChangeWatchSource {
  load(): Promise<ChangeCountRow[]>;
  /** Resets counters to 0: one project of one account, every project of one account, or all when no arguments are given. */
  clear(tenantId?: string, projectId?: string): Promise<void>;
}

export class SupabaseChangeWatchSource implements ChangeWatchSource {
  constructor(private readonly client: SupabaseClient) {}
  async load(): Promise<ChangeCountRow[]> {
    const { data, error } = await this.client.rpc("change_counts");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ChangeCountRow[];
  }
  async clear(tenantId?: string, projectId?: string): Promise<void> {
    const { error } = await this.client.rpc("clear_change_counts", { p_tenant: tenantId ?? null, p_project: projectId ?? null });
    if (error) throw new Error(error.message);
  }
}

export class MemoryChangeWatchSource implements ChangeWatchSource {
  calls: string[] = [];
  constructor(public rows: ChangeCountRow[] = []) {}
  async load() { return this.rows.map((r) => ({ ...r })); }
  async clear(tenantId?: string, projectId?: string) {
    this.calls.push(`clear ${tenantId ?? "all"}${projectId ? `/${projectId}` : ""}`);
    this.rows = this.rows.filter((r) => !((!tenantId || r.tenant_id === tenantId) && (!projectId || r.project_id === projectId)));
  }
}
