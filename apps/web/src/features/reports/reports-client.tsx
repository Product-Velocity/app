"use client";

import { useCallback, useMemo } from "react";
import type { FeedRow, JiraStatusRecord, TrackerRef } from "@pv/domain";
import { createClient } from "@/lib/supabase/browser";
import { SupabaseGateSource } from "../gates/gate-source";
import { useWorkspaceController } from "../portfolio/portfolio-client";
import type { Lookups } from "../portfolio/types";
import { ReportsView } from "./reports-view";

/** Loads every item of the workspace (as the grid does), then shows the Reports tab. */
export function ReportsClient({ tenantId, role, userId, lookups }: { tenantId: string; role: string; userId: string; lookups: Lookups }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups, userId);
  const gates = useMemo(() => new SupabaseGateSource(createClient(), tenantId), [tenantId]);
  /** The changes of a period (issue #472): the database function is readable by every member of the workspace. */
  const loadChanges = useCallback(async (from: Date, to: Date): Promise<FeedRow[]> => {
    const { data, error } = await createClient().rpc("change_feed", { p_tenant: tenantId, p_from: from.toISOString(), p_to: to.toISOString() });
    if (error) throw new Error(error.message);
    return (data ?? []) as FeedRow[];
  }, [tenantId]);
  /** The tracker issue each initiative is linked to (Jira epic or GitHub issue), read through the member's own access: key, link and, for Jira, the issue's name. */
  const loadTrackerIssues = useCallback(async (itemIds: string[]): Promise<Map<string, TrackerRef>> => {
    const client = createClient();
    const out = new Map<string, TrackerRef>();
    const ids = [...new Set(itemIds)];
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      const [jira, gh] = await Promise.all([
        client.from("item_jira_links").select("item_id, issue_key, html_url").eq("tenant_id", tenantId).in("item_id", chunk),
        client.from("item_github_links").select("item_id, repo_full_name, issue_number, html_url").eq("tenant_id", tenantId).in("item_id", chunk).not("issue_number", "is", null),
      ]);
      if (jira.error) throw new Error(jira.error.message);
      if (gh.error) throw new Error(gh.error.message);
      const jl = (jira.data ?? []) as { item_id: string; issue_key: string; html_url: string | null }[];
      const titles = new Map<string, string>();
      if (jl.length > 0) {
        const t = await client.from("jira_issues").select("issue_key, title").eq("tenant_id", tenantId).in("issue_key", jl.map((l) => l.issue_key));
        if (!t.error) for (const r of (t.data ?? []) as { issue_key: string; title: string }[]) titles.set(r.issue_key, r.title);
      }
      for (const l of jl) out.set(l.item_id, { tracker: "Jira", key: l.issue_key, title: titles.get(l.issue_key) ?? null, url: l.html_url });
      for (const l of (gh.data ?? []) as { item_id: string; repo_full_name: string; issue_number: number; html_url: string | null }[]) if (!out.has(l.item_id)) out.set(l.item_id, { tracker: "GitHub", key: `${l.repo_full_name}#${l.issue_number}`, title: null, url: l.html_url });
    }
    return out;
  }, [tenantId]);
  /** Who moved Jira issues to a status (table jira_status_changes: Jira's own history, read through the member's own access). Starts two days before the period: a daily check can register a change hours after Jira made it. */
  const loadJiraUsers = useCallback(async (issueKeys: string[], from: Date, to: Date): Promise<JiraStatusRecord[]> => {
    const client = createClient();
    const out: JiraStatusRecord[] = [];
    for (let i = 0; i < issueKeys.length; i += 150) {
      const { data, error } = await client.from("jira_status_changes").select("issue_key, to_status, changed_at, actor_name").eq("tenant_id", tenantId)
        .in("issue_key", issueKeys.slice(i, i + 150)).gte("changed_at", new Date(from.getTime() - 2 * 86_400_000).toISOString()).lte("changed_at", to.toISOString()).limit(5000);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as JiraStatusRecord[]));
    }
    return out;
  }, [tenantId]);
  if (state.kind === "loading") return <><div className="page-head"><h1>Reports</h1></div><p role="status" className="muted">Loading the roadmap…</p></>;
  if (state.kind === "error") {
    return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  }
  return <ReportsView controller={state.controller} lookups={lookups} me={userId} loadGateRequests={() => gates.loadRequests()} loadChanges={loadChanges} loadTrackerIssues={loadTrackerIssues} loadJiraUsers={loadJiraUsers} gateSource={gates} />;
}
