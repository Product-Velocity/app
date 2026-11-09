"use server";

import { labelFields, receivedValue } from "@pv/github";
import { readIssue } from "@/lib/atlassian/jira-issue";
import { descriptionFromJiraAdf } from "@/lib/atlassian/jira-pull-text";
import { jiraRequest } from "@/lib/atlassian/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspace } from "@/lib/session";
import type { CopyResult } from "./copy-descriptions";

const CONCURRENCY = 5;
export type JiraCopyResult = CopyResult & { /** Jira refused the sign-in: the connection has to be signed in again. */ reconnect?: boolean };

/**
 * The Jira twin of `copyIssueDescriptions` (issue #365, parity with #364). Once, when a person pulls a Jira issue in (and again on Re-pull), the issue
 * is read with the connection and the initiative gets what is still empty: its Description (the Jira description converted to Markdown, cut at 20,000
 * characters, our markers and @mentions neutralised; a description Product Velocity wrote uses its Description section), Change Type from exactly one
 * `type:` label and Focus Area from exactly one `area:` label (`labelFields`, the same rules as GitHub). Labels are the ones Jira shows now, else the
 * Incoming record's. It never replaces a value (the database refuses), writes nothing to Jira, and never maps the Jira issue type. The text is data,
 * never instructions (CLAUDE.md rule 4). Nothing is logged but counts; a failure here never undoes the pull-in.
 */
export async function copyJiraIssueTexts(itemIds: string[]): Promise<JiraCopyResult> {
  return fillFromJira(itemIds);
}

/** Re-pull: the same fill, run again for initiatives that were pulled in earlier. */
export async function refreshPulledFromJira(itemIds: string[]): Promise<JiraCopyResult> {
  return fillFromJira(itemIds);
}

async function fillFromJira(itemIds: string[]): Promise<JiraCopyResult> {
  const ids = [...new Set(itemIds)].filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
  if (ids.length === 0) return { copied: 0, failed: 0 };
  const { supabase, user, active } = await requireWorkspace("/incoming");
  if (active.platform || !["creator", "admin"].includes(active.role)) return { copied: 0, failed: ids.length };

  const [{ data: items }, { data: links }, { data: records }] = await Promise.all([
    supabase.from("items").select("id, source, description").eq("tenant_id", active.tenantId).is("deleted_at", null).in("id", ids),
    supabase.from("item_jira_links").select("item_id, connection_id, site_id, issue_key").eq("tenant_id", active.tenantId).in("item_id", ids),
    supabase.from("jira_issues").select("item_id, labels").eq("tenant_id", active.tenantId).in("item_id", ids),
  ]);
  const todo = ((items ?? []) as { id: string; source: string | null; description: string | null }[]).filter((i) => (i.source ?? "").startsWith("Jira issue "));
  const linkOf = new Map(((links ?? []) as { item_id: string; connection_id: string; site_id: string; issue_key: string }[]).map((l) => [l.item_id, l]));
  const labelsOf = new Map(((records ?? []) as { item_id: string; labels: string[] | null }[]).map((r) => [r.item_id, r.labels ?? []]));
  const admin = createAdminClient({ via: "UI" });
  let copied = 0;
  let labelled = 0;
  let failed = 0;
  let noText = 0;
  let reconnect = false;
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < todo.length; i = next++) {
      const item = todo[i]!;
      const link = linkOf.get(item.id);
      if (!link) { failed++; continue; }
      const needsBody = !(item.description ?? "").trim();
      let read: Awaited<ReturnType<typeof readIssue>>;
      try { read = await readIssue(jiraRequest(link.connection_id, link.site_id), link.issue_key); } catch (e) {
        read = { ok: false, kind: "unavailable", message: "unreadable" };
        console.error(JSON.stringify({ jira: "copy-description", error: e instanceof Error ? e.message.slice(0, 120) : "unknown" }));
      }
      if (!read.ok && read.kind === "reconnect") reconnect = true;
      const fromLabels = labelFields(read.ok ? read.issue.labels : labelsOf.get(item.id));
      if (fromLabels.changeType || fromLabels.focusArea) {
        const { data, error } = await admin.rpc("jira_copy_issue_labels", { p_actor: user.id, p_item: item.id, p_change_type: fromLabels.changeType ?? null, p_focus_area: fromLabels.focusArea ?? null });
        if (!error && data && Object.keys(data as object).length > 0) labelled++;
      }
      if (!needsBody) continue; // a Description is never replaced
      if (!read.ok) { failed++; continue; }
      const text = receivedValue("description", descriptionFromJiraAdf(read.issue.description).text);
      if (!text) { noText++; continue; } // an issue without a description has nothing to copy
      const { data, error } = await admin.rpc("jira_copy_issue_description", { p_actor: user.id, p_item: item.id, p_text: text });
      if (error) failed++;
      else if (data === true) copied++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return { copied, failed, labelled, checked: todo.length, noText, ...(reconnect ? { reconnect: true } : {}) };
}
