"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useWorkspaceController } from "../portfolio/portfolio-client";
import type { Lookups } from "../portfolio/types";
import { LeadershipView } from "./leadership-view";
import { SupabaseLeadershipStore } from "./store";

/** Loads every item of the workspace (as the grid does), then shows the leadership view. */
export function LeadershipClient({ tenantId, role, userId, lookups }: { tenantId: string; role: string; userId: string; lookups: Lookups }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups);
  const store = useMemo(() => new SupabaseLeadershipStore(createClient(), tenantId), [tenantId]);
  if (state.kind === "loading") return <><div className="page-head"><h1>Leadership</h1></div><p role="status" className="muted">Loading the roadmap…</p></>;
  if (state.kind === "error") {
    return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  }
  return <LeadershipView controller={state.controller} lookups={lookups} me={userId} store={store} />;
}
