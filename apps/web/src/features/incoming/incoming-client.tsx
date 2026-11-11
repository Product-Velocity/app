"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { refreshJiraNewItems } from "@/app/(workspace)/portfolio/new-items";
import { IncomingView } from "./incoming-view";
import { SupabaseIncomingSource } from "./supabase-source";
import { SupabaseJiraIncomingSource } from "./supabase-jira-source";
import { GITHUB_TERMS, JIRA_TERMS } from "./types";

type Props = { tenantId: string; projects: { id: string; name: string }[]; canEdit: boolean; canAdmin: boolean; tracker?: "github" | "jira" };

export function IncomingClient({ tenantId, projects, canEdit, canAdmin, tracker = "github" }: Props) {
  const source = useMemo(() => (tracker === "jira" ? new SupabaseJiraIncomingSource(createClient(), tenantId) : new SupabaseIncomingSource(createClient(), tenantId)), [tenantId, tracker]);
  const [reads, setReads] = useState(0);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function readJira() {
    setReading(true);
    setNote(null);
    try {
      const r = await refreshJiraNewItems();
      if (!r.ok) setNote(r.error);
      else if (r.reconnect > 0) setNote("Jira needs a new sign-in. A workspace admin can sign in again under Settings > Integrations > Jira.");
      else setNote(r.failed > 0 ? `Read ${r.projects} Jira ${r.projects === 1 ? "project" : "projects"}; ${r.failed} could not be read.` : `Read ${r.projects} Jira ${r.projects === 1 ? "project" : "projects"}.`);
      setReads((n) => n + 1);
    } catch {
      setNote("Jira could not be read. Try again in a minute.");
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      {tracker === "jira" && canEdit && (
        <div className="incoming-check">
          <button className="btn" type="button" disabled={reading} onClick={() => void readJira()}>{reading ? "Reading Jira…" : "Read Jira now"}</button>
          {note && <span className="muted" role="status">{note}</span>}
        </div>
      )}
      <IncomingView key={`${tracker}-${reads}`} source={source} terms={tracker === "jira" ? JIRA_TERMS : GITHUB_TERMS} projects={projects} canEdit={canEdit} canAdmin={canAdmin} />
    </>
  );
}
