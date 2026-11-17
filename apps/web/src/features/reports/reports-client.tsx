"use client";

import { useCallback, useMemo } from "react";
import type { FeedRow } from "@pv/domain";
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
  if (state.kind === "loading") return <><div className="page-head"><h1>Reports</h1></div><p role="status" className="muted">Loading the roadmap…</p></>;
  if (state.kind === "error") {
    return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  }
  return <ReportsView controller={state.controller} lookups={lookups} me={userId} loadGateRequests={() => gates.loadRequests()} loadChanges={loadChanges} />;
}
