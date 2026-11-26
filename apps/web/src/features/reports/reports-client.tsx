"use client";

import { useCallback, useMemo } from "react";
import type { FeedRow, JiraStatusRecord, TrackerRef } from "@pv/domain";
import { createClient } from "@/lib/supabase/browser";
import { SupabaseGateSource } from "../gates/gate-source";
import { useWorkspaceController } from "../portfolio/portfolio-client";
import type { Lookups } from "../portfolio/types";
import { ReportsView } from "./reports-view";
import { loadTrackerIssues as loadTrackers } from "./tracker-issues";

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
  /** The tracker issue each initiative is linked to (see tracker-issues.ts). */
  const loadTrackerIssues = useCallback((itemIds: string[]): Promise<Map<string, TrackerRef>> => loadTrackers(createClient(), tenantId, itemIds), [tenantId]);
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
  /** The child issues and sub-tasks of each initiative's linked Jira issue (table item_jira_tree, read through the member's own access). */
  const loadJiraChildren = useCallback(async (itemIds: string[]): Promise<Map<string, string[]>> => {
    const client = createClient();
    const out = new Map<string, string[]>();
    for (let i = 0; i < itemIds.length; i += 150) {
      const { data, error } = await client.from("item_jira_tree").select("item_id, issue_key").eq("tenant_id", tenantId).in("item_id", itemIds.slice(i, i + 150)).limit(5000);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { item_id: string; issue_key: string }[]) out.set(r.item_id, [...(out.get(r.item_id) ?? []), r.issue_key]);
    }
    return out;
  }, [tenantId]);
  if (state.kind === "loading") return <><div className="page-head"><h1>Reports</h1></div><p role="status" className="muted">Loading the roadmap…</p></>;
  if (state.kind === "error") {
    return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  }
  return <ReportsView controller={state.controller} lookups={lookups} me={userId} loadGateRequests={() => gates.loadRequests()} loadChanges={loadChanges} loadTrackerIssues={loadTrackerIssues} loadJiraUsers={loadJiraUsers} loadJiraChildren={loadJiraChildren} gateSource={gates} />;
}
