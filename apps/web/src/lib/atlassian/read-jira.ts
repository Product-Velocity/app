import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readOpenWork, type JiraIssueRow, type SearchPage } from "./read-issues";
import { jiraGet } from "./server";
import { ReconnectNeeded } from "./token-provider";

export type LinkToRead = { id: string; tenant_id: string; connection_id: string; site_id: string; jira_project_key: string };
export type ReadSummary = { total: number; added: number; changed: number; truncated: boolean };

const rpcRows = (rows: JiraIssueRow[]) => rows.map((r) => ({ key: r.key, id: r.id, title: r.title, type: r.type, level: r.level, labels: r.labels, status: r.status, category: r.category, parent: r.parent, url: r.url, updated: r.updated }));

/**
 * Reads the open work of one linked Jira project into jira_issues (light records, Not pulled by default) and records what happened in
 * jira_reads. Reads Jira only; nothing is written to Jira. Throws after recording the reason when Jira cannot be read.
 */
export async function readJiraLink(link: LinkToRead, siteUrl: string): Promise<ReadSummary & { rows: JiraIssueRow[] }> {
  const admin = createAdminClient({ via: "system" });
  const record = async (s: ReadSummary, error: string | null) => {
    await admin.from("jira_reads").upsert({ link_id: link.id, tenant_id: link.tenant_id, read_at: new Date().toISOString(), total: s.total, added: s.added, changed: s.changed, truncated: s.truncated, error }, { onConflict: "link_id" });
  };
  try {
    const { rows, truncated } = await readOpenWork((path) => jiraGet<SearchPage>(link.connection_id, link.site_id, path), link.jira_project_key, siteUrl);
    let added = 0;
    let changed = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await admin.rpc("jira_upsert_issues", { p_link: link.id, p_rows: rpcRows(rows.slice(i, i + 500)) });
      if (error) throw new Error("Could not save the issues");
      const r = data as { added: number; changed: number };
      added += r.added;
      changed += r.changed;
    }
    const summary = { total: rows.length, added, changed, truncated };
    await record(summary, null);
    return { ...summary, rows };
  } catch (e) {
    const reason = e instanceof ReconnectNeeded ? "Sign in to Jira again." : e instanceof Error ? e.message.slice(0, 200) : "unknown";
    await record({ total: 0, added: 0, changed: 0, truncated: false }, reason);
    throw e;
  }
}
