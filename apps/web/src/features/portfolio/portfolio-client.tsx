"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/browser";
import { PortfolioController } from "./controller";
import { supabaseNewItems } from "./new-items";
import { PortfolioGrid } from "./portfolio-grid";
import { SupabaseDataSource } from "./supabase-source";
import type { Lookups } from "./types";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; controller: PortfolioController };

/** Loads every item of the workspace into a controller (the roadmap and the item page both start from it). */
export function useWorkspaceController(tenantId: string, role: string, lookups: Lookups, userId: string | null = null) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const source = useMemo(() => new SupabaseDataSource(createClient(), tenantId, createClient("import")), [tenantId]);

  useEffect(() => {
    let cancelled = false;
    source
      .loadItems()
      .then((items) => { if (!cancelled) setState({ kind: "ready", controller: new PortfolioController(source, items, lookups, role, undefined, undefined, undefined, userId) }); })
      .catch((e: Error) => { if (!cancelled) setState({ kind: "error", message: e.message }); });
    return () => { cancelled = true; };
  }, [source, lookups, role, userId, attempt]);
  const retry = () => { setState({ kind: "loading" }); setAttempt((n) => n + 1); };
  return { state, retry };
}

/** Loads every item of the workspace, then shows the grid. */
export function PortfolioClient({ tenantId, role, lookups, userId, headLeft, headRight }: { tenantId: string; role: string; lookups: Lookups; userId: string; headLeft?: ReactNode; headRight?: ReactNode }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups, userId);
  const newItems = useMemo(() => supabaseNewItems(tenantId, role), [tenantId, role]);

  if (state.kind === "loading") return <><div className="page-head">{headLeft}</div><p role="status" className="muted">Loading the roadmap…</p></>;
  if (state.kind === "error") {
    return (
      <>
        <div className="page-head">{headLeft}</div>
        <div role="alert" className="error">
          Could not load the roadmap: {state.message}{" "}
          <button type="button" className="link-button" onClick={retry}>Try again</button>
        </div>
      </>
    );
  }
  return <PortfolioGrid controller={state.controller} lookups={lookups} me={userId} newItems={newItems} headLeft={headLeft} headRight={headRight} />;
}
