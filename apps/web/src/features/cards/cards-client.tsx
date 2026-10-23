"use client";

import { useWorkspaceController } from "../portfolio/portfolio-client";
import type { Lookups } from "../portfolio/types";
import { CardsView } from "./cards-view";

/** Loads every item of the workspace (as the grid does), then shows the cards. */
export function CardsClient({ tenantId, role, userId, lookups }: { tenantId: string; role: string; userId: string; lookups: Lookups }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups);
  if (state.kind === "loading") return <><div className="page-head"><h1>Cards</h1></div><p role="status" className="muted">Loading the roadmap…</p></>;
  if (state.kind === "error") {
    return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  }
  return <CardsView controller={state.controller} lookups={lookups} me={userId} />;
}
