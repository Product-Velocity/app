"use client";

import { useEffect, useState } from "react";
import { buildChangeRows, type ChangeRowData, type FeedRow, type ItemInfo, type TrackerRef } from "@pv/domain";
import { createClient } from "@/lib/supabase/browser";
import { loadTrackerIssues } from "../reports/tracker-issues";
import type { PortfolioController } from "../portfolio/controller";
import { useStatus } from "../portfolio/status-strip";

const DAYS = 30;

/** Where the feed comes from: the database in the app, a fixture in the dev harness. */
export type ChangeSource = { load(tenantId: string): Promise<{ feed: FeedRow[]; issues: Map<string, TrackerRef> }> };
export const supabaseChangeSource: ChangeSource = {
  async load(tenantId) {
    const client = createClient();
    const to = new Date(Date.now() + 86_400_000);
    const from = new Date(Date.now() - DAYS * 86_400_000);
    const { data, error } = await client.rpc("change_feed", { p_tenant: tenantId, p_from: from.toISOString(), p_to: to.toISOString() });
    if (error) throw new Error(error.message);
    const feed = (data ?? []) as FeedRow[];
    const issues = await loadTrackerIssues(client, tenantId, [...new Set(feed.map((r) => r.item_id))]).catch(() => new Map<string, TrackerRef>());
    return { feed, issues };
  },
};

/**
 * The changes of the last 30 days on the initiatives of the roadmap, newest first (issue #635). The database function change_feed is readable by every member of the
 * workspace (the audit table itself is admin-only). The roadmap rows name the initiatives; the tracker links name the issues.
 */
export function usePhoneChanges(controller: PortfolioController, tenantId: string, source: ChangeSource = supabaseChangeSource): { rows: ChangeRowData[]; loading: boolean; error: string | null } {
  const status = useStatus(controller);
  const [feed, setFeed] = useState<FeedRow[] | null>(null);
  const [issues, setIssues] = useState<Map<string, TrackerRef> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    source.load(tenantId).then(
      ({ feed: f, issues: map }) => { if (!off) { setFeed(f); setIssues(map); } },
      (e: Error) => { if (!off) setError(e.message); },
    );
    return () => { off = true; };
  }, [tenantId, source]);

  const rows = (() => {
    if (!feed) return [];
    const items = new Map<string, ItemInfo>(controller.rows.map((r) => [r.id, { code: r.item_code, name: r.initiative_name, rank: r.stack_rank }]));
    return buildChangeRows(feed, items, { issues: issues ?? undefined });
  })();
  // the controller changes its rows in place; the version says when
  void status.version;
  return { rows, loading: feed === null && error === null, error };
}
