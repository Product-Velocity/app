"use client";

import { Loading } from "@/components/pill-loader";
import { leavingChildrenOut } from "@/lib/atlassian/child-filter";
import { useEffect, useState } from "react";
import { refreshJiraNewItems, refreshNewItems } from "@/app/(workspace)/portfolio/new-items";
import { createClient } from "@/lib/supabase/browser";
import { IncomingView } from "@/features/incoming/incoming-view";
import { SupabaseIncomingSource } from "@/features/incoming/supabase-source";
import { SupabaseJiraIncomingSource } from "@/features/incoming/supabase-jira-source";
import { GITHUB_TERMS, JIRA_TERMS, type IncomingSource, type IncomingTerms } from "@/features/incoming/types";

/** What the first step of Sync needs: how many issues are new, the projects they can go into, and the same triage source the Incoming page uses. */
export type NewItemsConfig = {
  /** Which tracker's new items this is; the Sync dialog shows the step of each tracker the selected initiatives belong to. */
  tracker: "github" | "jira";
  /** "GitHub" or "Jira", for the words on the screen. */
  name: string;
  terms: IncomingTerms;
  source: IncomingSource;
  /** Reads the tracker for what changed lately and keeps it in the list. May fail or be slow: the step then shows what it has. A returned text is shown above the list (for example: sign in to Jira again). */
  refresh?: () => Promise<string | void>;
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
    tracker: "github", name: "GitHub", terms: GITHUB_TERMS,
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

/** The Jira twin: the issues read from the linked Jira projects that nobody has decided on (issue #67 C2b). Each goes into its own linked project. */
export function supabaseJiraNewItems(tenantId: string, role: string): NewItemsConfig {
  const client = createClient();
  return {
    tracker: "jira", name: "Jira", terms: JIRA_TERMS,
    source: new SupabaseJiraIncomingSource(client, tenantId),
    async refresh() {
      const r = await refreshJiraNewItems();
      if (r.ok && r.reconnect > 0) return "Jira needs a new sign-in, so the list below may be out of date. A workspace admin can sign in again under Settings > Integrations > Jira.";
    },
    async count() {
      const { count, error } = await leavingChildrenOut((leaveOut) => {
        const q = client.from("jira_issues").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("pull_state", "not_pulled");
        return leaveOut ? q.is("child_of_item", null) : q;
      });
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async projects() {
      const { data, error } = await client.from("projects").select("id, name").eq("tenant_id", tenantId).eq("tracker", "jira").order("name");
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
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // read GitHub first (lightly), so an issue created a minute ago is in the list; a slow or failing read never stands in the way
        if (config.refresh) {
          const said = await Promise.race([config.refresh().catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, REFRESH_WAIT_MS))]);
          if (!live) return;
          if (typeof said === "string") setNotice(said);
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

  if (!shown) return <Loading>Checking {config.name} for new issues…</Loading>;
  return (
    <>
      {notice && <p role="alert" className="error">{notice}</p>}
      <p>
        {config.name} has <strong>{shown.count}</strong> {shown.count === 1 ? "issue" : "issues"} that {shown.count === 1 ? "is" : "are"} not an initiative yet. Decide what to do with them, or skip this and continue.
        Pulling in creates an initiative (read only, or owned by Product Velocity). Nothing is written to {config.name} in this step.
      </p>
      <IncomingView embedded terms={config.terms} source={config.source} projects={shown.projects} canEdit={config.canEdit} canAdmin={config.canAdmin} {...(onChanged ? { onChanged } : {})} />
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={onContinue}>Continue to sync</button>
      </div>
    </>
  );
}
