"use client";

import { useWorkspaceController } from "../portfolio/portfolio-client";
import type { Lookups } from "../portfolio/types";
import { ReportsView } from "./reports-view";

/** Loads every item of the workspace (as the grid does), then shows the Reports tab. */
export function ReportsClient({ tenantId, role, userId, lookups }: { tenantId: string; role: string; userId: string; lookups: Lookups }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups, userId);
  if (state.kind === "loading") return <><div className="page-head"><h1>Reports</h1></div><p role="status" className="muted">Loading the roadmap…</p></>;
  if (state.kind === "error") {
    return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  }
  return <ReportsView controller={state.controller} lookups={lookups} me={userId} />;
}
