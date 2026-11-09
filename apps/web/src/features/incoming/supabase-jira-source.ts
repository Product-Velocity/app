import { copyJiraIssueTexts, refreshPulledFromJira } from "@/app/(workspace)/incoming/copy-jira-texts";
import { leavingChildrenOut } from "@/lib/atlassian/child-filter";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BatchOutcome, IncomingIssue, IncomingRule, IncomingSource, Ownership, PullState, RefreshResult, RuleResult } from "./types";

// The Jira side of the "new items" list (issue #67 C2b). It maps Jira's light records into the shape the list already shows
// (repo = the Jira project key, number = the number of the key), so one list serves both trackers. Jira has no saved rules yet.

const PAGE = 1000;
const msg = (e: { message?: string } | null) => (e?.message ?? "Something went wrong.").slice(0, 200);
const NO_RULES: RuleResult = { ok: false, error: "Rules are not available for Jira yet." };

type Row = { id: string; jira_project_key: string; issue_key: string; title: string; issue_type: string | null; labels: string[] | null; status_category: string | null; parent_key: string | null; html_url: string | null; pull_state: string; ignore_reason: string | null; item_id: string | null; jira_updated_at: string | null; project_id: string };

const numberOf = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));

export function mapJiraRow(r: Row): IncomingIssue {
  return {
    id: r.id, repo: r.jira_project_key, number: numberOf(r.issue_key), title: r.title, issueType: r.issue_type, labels: r.labels ?? [],
    state: r.status_category === "done" ? "closed" : "open",
    // a parent in the same Jira project is shown like a sub-issue; a parent elsewhere is just not drawn
    parentNumber: r.parent_key && r.parent_key.startsWith(`${r.jira_project_key}-`) ? numberOf(r.parent_key) : null,
    url: r.html_url, pullState: r.pull_state as PullState, ignoreReason: r.ignore_reason, itemId: r.item_id, updatedAt: r.jira_updated_at,
  };
}

export class SupabaseJiraIncomingSource implements IncomingSource {
  constructor(private client: SupabaseClient, private tenantId: string) {}

  async load() {
    const { data: conn, error: ce } = await this.client.from("jira_connections").select("id").eq("tenant_id", this.tenantId).eq("state", "connected").order("created_at").limit(1).maybeSingle();
    if (ce) throw new Error(msg(ce));
    const issues: IncomingIssue[] = [];
    for (let from = 0; ; from += PAGE) {
      // the children of a linked initiative belong to its tree, not to this list
      const { data, error } = await leavingChildrenOut((leaveOut) => {
        const q = this.client.from("jira_issues")
          .select("id, project_id, jira_project_key, issue_key, title, issue_type, labels, status_category, parent_key, html_url, pull_state, ignore_reason, item_id, jira_updated_at")
          .eq("tenant_id", this.tenantId);
        return (leaveOut ? q.is("child_of_item", null) : q).order("jira_updated_at", { ascending: false, nullsFirst: false }).order("id").range(from, from + PAGE - 1);
      });
      if (error) throw new Error(msg(error));
      for (const r of (data ?? []) as Row[]) issues.push(mapJiraRow(r));
      if (!data || data.length < PAGE) break;
    }
    return { connectionId: (conn?.id as string | undefined) ?? "", issues, rules: [] as IncomingRule[] };
  }

  private async batch(fn: string, args: Record<string, unknown>): Promise<BatchOutcome[]> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) return [{ id: "", ok: false, reason: msg(error) }];
    return ((data ?? []) as { id: string; ok: boolean; reason: string | null; item_id?: string | null; item_code?: string | null }[]).map((r) => ({ id: r.id, ok: r.ok, reason: r.reason, itemId: r.item_id ?? null, itemCode: r.item_code ?? null }));
  }
  setState(ids: string[], state: "not_pulled" | "ignored", reason: string | null) { return this.batch("jira_set_state", { p_ids: ids, p_state: state, p_reason: reason }); }

  /** Each issue goes into the project linked to ITS Jira project, so the ids are grouped by project; the project argument is not used. */
  async pullIn(ids: string[], _projectId: string, ownership: Ownership): Promise<BatchOutcome[]> {
    const { data, error } = await this.client.from("jira_issues").select("id, project_id").eq("tenant_id", this.tenantId).in("id", ids);
    if (error) return [{ id: "", ok: false, reason: msg(error) }];
    const byProject = new Map<string, string[]>();
    for (const r of (data ?? []) as { id: string; project_id: string }[]) byProject.set(r.project_id, [...(byProject.get(r.project_id) ?? []), r.id]);
    const out: BatchOutcome[] = [];
    for (const [project, group] of byProject) out.push(...(await this.batch("jira_pull_in", { p_ids: group, p_project: project, p_mode: ownership })));
    // each issue's description and its type:/area: labels are kept once (issue #365); reading them never fails the pull-in
    const created = out.filter((o) => o.ok && o.itemId).map((o) => o.itemId as string);
    if (created.length === 0) return out;
    const r = await copyJiraIssueTexts(created).catch(() => ({ copied: 0, failed: created.length }));
    if (r.failed === 0) return out;
    const first = out.find((o) => o.ok);
    return out.map((o) => (o === first ? { ...o, note: `The text of ${r.failed} ${r.failed === 1 ? "issue" : "issues"} could not be read from Jira, so ${r.failed === 1 ? "its" : "their"} Description is empty.` } : o));
  }

  /** Re-pull of initiatives already pulled in: fills what is still empty from the issue (never replaces a value). */
  async refreshPulled(itemIds: string[]): Promise<RefreshResult> {
    try {
      const r = await refreshPulledFromJira(itemIds);
      if (r.reconnect) return { ok: false, error: "Jira refused the sign-in. Sign in again (Settings, Integrations, Jira), then try again." };
      return { ok: true, checked: r.checked ?? 0, descriptions: r.copied, labelled: r.labelled ?? 0, failed: r.failed, noText: r.noText ?? 0 };
    } catch {
      return { ok: false, error: "Jira could not be asked just now. Try again." };
    }
  }
  async discardItems(itemIds: string[]) {
    const { data, error } = await this.client.rpc("discard_new_items", { p_ids: itemIds });
    if (error) return { ok: false, error: msg(error) };
    const bad = ((data ?? []) as { ok: boolean; reason: string | null }[]).find((r) => !r.ok);
    return bad ? { ok: false, error: bad.reason ?? "An initiative was already changed or removed." } : { ok: true };
  }
  async addRule(): Promise<RuleResult> { return NO_RULES; }
  async removeRule(): Promise<RuleResult> { return NO_RULES; }
}
