import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildFieldCatalog, type JiraField, type JiraIssueSample } from "./field-catalog";
import { jiraGet } from "./server";
import { ReconnectNeeded } from "./token-provider";

// Reads the field catalog of one linked Jira project (issues #69): every field of the site from /field and a sample of the project's newest issues
// for the fill rate. Read-only calls; the result is cached in jira_field_catalogs so the settings page does not call Jira on every view.
// Lifetime of the cache: no automatic expiry. A site's field list changes only when a Jira admin adds or renames a field, and a refresh costs two
// Jira calls (the field list and one page of 100 issues), so the page shows when it was read and an admin presses "Refresh the list".

export const SAMPLE_SIZE = 100;
export type FieldLink = { id: string; tenant_id: string; connection_id: string; site_id: string; jira_project_key: string };
type SamplePage = { issues?: JiraIssueSample[] };

export function samplePath(projectKey: string): string {
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(projectKey)) throw new Error("Not a Jira project key");
  const q = new URLSearchParams({ jql: `project = "${projectKey}" ORDER BY updated DESC`, maxResults: String(SAMPLE_SIZE), fields: "*all" });
  return `/search/jql?${q.toString()}`;
}

/** Reads the fields and the sample and stores the catalog. On a failure the previous catalog stays and the reason is recorded; the error is rethrown. */
export async function refreshFieldCatalog(link: FieldLink, actor: string): Promise<{ fields: number; sampled: number }> {
  const admin = createAdminClient({ via: "system" });
  try {
    const [fields, sample] = await Promise.all([
      jiraGet<JiraField[]>(link.connection_id, link.site_id, "/field"),
      jiraGet<SamplePage>(link.connection_id, link.site_id, samplePath(link.jira_project_key)),
    ]);
    const issues = (sample.issues ?? []).slice(0, SAMPLE_SIZE);
    const rows = buildFieldCatalog(Array.isArray(fields) ? fields.slice(0, 1500) : [], issues);
    const { error } = await admin.from("jira_field_catalogs").upsert(
      { link_id: link.id, tenant_id: link.tenant_id, fields: rows, sampled: issues.length, refreshed_at: new Date().toISOString(), refreshed_by: actor, error: null },
      { onConflict: "link_id" },
    );
    if (error) throw new Error("Could not save the field catalog");
    return { fields: rows.length, sampled: issues.length };
  } catch (e) {
    const reason = e instanceof ReconnectNeeded ? "Sign in to Jira again." : e instanceof Error ? e.message.slice(0, 200) : "unknown";
    // keep the earlier catalog (if any) and note why this read failed
    const { data: existing } = await admin.from("jira_field_catalogs").select("link_id").eq("link_id", link.id).maybeSingle();
    if (existing) await admin.from("jira_field_catalogs").update({ error: reason }).eq("link_id", link.id);
    else await admin.from("jira_field_catalogs").insert({ link_id: link.id, tenant_id: link.tenant_id, error: reason });
    throw e;
  }
}
