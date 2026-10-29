"use client";

import { useEffect, useState } from "react";
import { refreshNewItems } from "@/app/(workspace)/portfolio/new-items";
import { createClient } from "@/lib/supabase/browser";
import { IncomingView } from "@/features/incoming/incoming-view";
import { SupabaseIncomingSource } from "@/features/incoming/supabase-source";
import type { IncomingSource } from "@/features/incoming/types";

/** What the first step of Sync needs: how many issues are new, the projects they can go into, and the same triage source the Incoming page uses. */
export type NewItemsConfig = {
  source: IncomingSource;
  /** Reads GitHub for what changed lately and keeps it in the list. May fail or be slow: the step then shows what it has. */
  refresh?: () => Promise<void>;
  /** Issues in the tracker that are Not pulled. */
  count(): Promise<number>;
  /** Projects an issue can be pulled into (those without a tracker, or linked to this one). */
  projects(): Promise<{ id: string; name: string }[]>;
  canEdit: boolean;
  canAdmin: boolean;
};

/** The real thing: Supabase, as the signed-in person (tenant-scoped by row-level security). */
export function supabaseNewItems(tenantId: string, role: string): NewItemsConfig {
  const client = createClient();
  return {
    source: new SupabaseIncomingSource(client, tenantId),
    async refresh() { await refreshNewItems(); },
    async count() {
      const { count, error } = await client.from("tracker_issues").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("pull_state", "not_pulled");
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async projects() {
      const { data, error } = await client.from("projects").select("id, name").eq("tenant_id", tenantId).or("tracker.is.null,tracker.eq.github").order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string }[];
    },
    canEdit: ["creator", "admin"].includes(role),
    canAdmin: role === "admin",
  };
}

/**
 * Step 1 of Sync: what is new in the tracker, to decide on before the initiatives are compared. With nothing new (or if it cannot be
 * found out) it moves on by itself, so it never stands in the way of the sync. Nothing is written to the tracker in this step.
 */
/** The longest the step waits for GitHub before it shows what it already has. */
const REFRESH_WAIT_MS = 8000;

export function NewItemsStep({ config, onContinue, onCancel, onChanged }: { config: NewItemsConfig; onContinue: () => void; onCancel: () => void; /** Initiatives were created or removed here: the grid behind this window reads the roadmap again. */ onChanged?: () => void }) {
  const [shown, setShown] = useState<{ count: number; projects: { id: string; name: string }[] } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // read GitHub first (lightly), so an issue created a minute ago is in the list; a slow or failing read never stands in the way
        if (config.refresh) {
          await Promise.race([config.refresh().catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, REFRESH_WAIT_MS))]);
          if (!live) return;
        }
        const count = await config.count();
        if (!live) return;
        if (count === 0) { onContinue(); return; }
        const projects = await config.projects();
        if (live) setShown({ count, projects });
      } catch {
        if (live) onContinue(); // never block the sync because the list of new issues could not be read
      }
    })();
    return () => { live = false; };
  }, [config, onContinue]);

  if (!shown) return <p role="status" className="muted">Checking GitHub for new issues…</p>;
  return (
    <>
      <p>
        GitHub has <strong>{shown.count}</strong> {shown.count === 1 ? "issue" : "issues"} that {shown.count === 1 ? "is" : "are"} not an initiative yet. Decide what to do with them, or skip this and continue.
        Pulling in creates an initiative (read only, or owned by Product Velocity). Nothing is written to GitHub in this step.
      </p>
      <IncomingView embedded source={config.source} projects={shown.projects} canEdit={config.canEdit} canAdmin={config.canAdmin} {...(onChanged ? { onChanged } : {})} />
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={onContinue}>Continue to sync</button>
      </div>
    </>
  );
}
