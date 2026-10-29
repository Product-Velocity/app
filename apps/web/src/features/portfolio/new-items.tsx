"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { IncomingView } from "@/features/incoming/incoming-view";
import { SupabaseIncomingSource } from "@/features/incoming/supabase-source";
import type { IncomingSource } from "@/features/incoming/types";

/** What the first step of Sync needs: how many issues are new, the projects they can go into, and the same triage source the Incoming page uses. */
export type NewItemsConfig = {
  source: IncomingSource;
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
export function NewItemsStep({ config, onContinue }: { config: NewItemsConfig; onContinue: () => void }) {
  const [shown, setShown] = useState<{ count: number; projects: { id: string; name: string }[] } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
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

  if (!shown) return <p role="status" className="muted">Looking for new issues…</p>;
  return (
    <>
      <p>
        GitHub has <strong>{shown.count}</strong> {shown.count === 1 ? "issue" : "issues"} that {shown.count === 1 ? "is" : "are"} not an initiative yet. Decide what to do with them, or skip this and continue.
        Pulling in creates an initiative (read only, or owned by Product Velocity). Nothing is written to GitHub in this step.
      </p>
      <IncomingView embedded source={config.source} projects={shown.projects} canEdit={config.canEdit} canAdmin={config.canAdmin} />
      <div className="dialog-actions"><button type="button" className="btn btn-primary" onClick={onContinue}>Continue to sync</button></div>
    </>
  );
}
