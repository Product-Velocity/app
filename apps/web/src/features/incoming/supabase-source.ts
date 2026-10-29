import type { SupabaseClient } from "@supabase/supabase-js";
import type { BatchOutcome, IncomingIssue, IncomingRule, IncomingSource, PullState, RuleResult, Ownership } from "./types";

const PAGE = 1000;
const msg = (e: { message?: string } | null) => (e?.message ?? "Something went wrong.").slice(0, 200);

export class SupabaseIncomingSource implements IncomingSource {
  constructor(private client: SupabaseClient, private tenantId: string) {}

  async load() {
    const { data: conn, error: ce } = await this.client.from("github_connections").select("id").eq("tenant_id", this.tenantId).eq("state", "connected").maybeSingle();
    if (ce) throw new Error(msg(ce));
    if (!conn) throw new Error("This workspace is not connected to GitHub.");
    const issues: IncomingIssue[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client.from("tracker_issues")
        .select("id, repo_full_name, issue_number, title, issue_type, labels, state, parent_number, html_url, pull_state, ignore_reason, item_id, gh_updated_at")
        .eq("tenant_id", this.tenantId).eq("connection_id", conn.id).order("gh_updated_at", { ascending: false, nullsFirst: false }).order("id").range(from, from + PAGE - 1);
      if (error) throw new Error(msg(error));
      for (const r of data ?? []) {
        issues.push({ id: r.id, repo: r.repo_full_name, number: r.issue_number, title: r.title, issueType: r.issue_type, labels: r.labels ?? [], state: r.state === "closed" ? "closed" : "open", parentNumber: r.parent_number, url: r.html_url, pullState: r.pull_state as PullState, ignoreReason: r.ignore_reason, itemId: r.item_id, updatedAt: r.gh_updated_at });
      }
      if (!data || data.length < PAGE) break;
    }
    const { data: ruleRows, error: re } = await this.client.from("tracker_rules").select("id, kind, value").eq("tenant_id", this.tenantId).eq("connection_id", conn.id).is("removed_at", null).order("created_at");
    if (re) throw new Error(msg(re));
    return { connectionId: conn.id as string, issues, rules: (ruleRows ?? []) as IncomingRule[] };
  }

  private async batch(fn: string, args: Record<string, unknown>): Promise<BatchOutcome[]> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) return [{ id: "", ok: false, reason: msg(error) }];
    return ((data ?? []) as { id: string; ok: boolean; reason: string | null; item_id?: string | null; item_code?: string | null }[]).map((r) => ({ id: r.id, ok: r.ok, reason: r.reason, itemId: r.item_id ?? null, itemCode: r.item_code ?? null }));
  }
  setState(ids: string[], state: "not_pulled" | "ignored", reason: string | null) { return this.batch("tracker_set_state", { p_ids: ids, p_state: state, p_reason: reason }); }
  pullIn(ids: string[], projectId: string, ownership: Ownership) { return this.batch("tracker_pull_in", { p_ids: ids, p_project: projectId, p_mode: ownership }); }
  async discardItems(itemIds: string[]) {
    const { data, error } = await this.client.rpc("discard_new_items", { p_ids: itemIds });
    if (error) return { ok: false, error: msg(error) };
    const bad = ((data ?? []) as { ok: boolean; reason: string | null }[]).find((r) => !r.ok);
    return bad ? { ok: false, error: bad.reason ?? "An initiative was already changed or removed." } : { ok: true };
  }
  async addRule(connectionId: string, kind: IncomingRule["kind"], value: string): Promise<RuleResult> {
    const { error } = await this.client.rpc("tracker_rule_add", { p_connection: connectionId, p_kind: kind, p_value: value });
    return error ? { ok: false, error: error.code === "23505" ? "That rule already exists." : msg(error) } : { ok: true };
  }
  async removeRule(ruleId: string): Promise<RuleResult> {
    const { error } = await this.client.rpc("tracker_rule_remove", { p_rule: ruleId });
    return error ? { ok: false, error: msg(error) } : { ok: true };
  }
}
