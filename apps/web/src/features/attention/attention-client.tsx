"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/browser";
import { SupabaseGateSource } from "../gates/gate-source";
import { useWorkspaceController } from "../portfolio/portfolio-client";
import type { Lookups } from "../portfolio/types";
import { AttentionView } from "./attention-view";

/** Loads every initiative of the workspace (as the grid does), then shows what needs attention. */
export function AttentionClient({ tenantId, role, userId, lookups }: { tenantId: string; role: string; userId: string; lookups: Lookups }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups);
  const gates = useMemo(() => new SupabaseGateSource(createClient(), tenantId), [tenantId]);
  if (state.kind === "loading") return <><div className="page-head"><h1>Needs attention</h1></div><p role="status" className="muted">Loading the roadmap…</p></>;
  if (state.kind === "error") return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  return <AttentionView controller={state.controller} lookups={lookups} me={userId} source={gates} />;
}
