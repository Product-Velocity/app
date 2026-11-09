"use server";

import { BLOCK_START, labelFields, receivedValue } from "@pv/github";
import { githubSourceControl, type ConnectionRow } from "@/lib/github/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspace } from "@/lib/session";

const CONCURRENCY = 5;
export type CopyResult = { copied: number; failed: number; /** Initiatives that got a Change Type or Focus Area from the `type:` and `area:` labels. */ labelled?: number; /** Initiatives pulled in from a GitHub issue that were looked at. */ checked?: number };

/**
 * Pull-in keeps the issue's text (Ashu, 2026-11-09, issue #364): once, when a person pulls an issue in, the issue body is read from
 * GitHub and stored as the initiative's Description. It is a snapshot, never refreshed and never written back by itself, it only
 * fills an empty Description (the database refuses to replace text a person wrote), and it is stored as text: an issue body is data,
 * never instructions (CLAUDE.md rule 4). The body is cut at 20,000 characters and our markers and @mentions are neutralised, as for
 * every text read from GitHub. A body that already holds a Product Velocity block is skipped (Product Velocity wrote it).
 * The labels `type:<x>` (Change Type) and `area:<x>` (Focus Area) are kept the same way, from the Incoming record, only into empty fields
 * (`labelFields`, `github_copy_issue_labels`); a label that means nothing in Product Velocity is left out, never guessed.
 * Nothing is logged but counts. A failure here never undoes the pull-in: the initiative exists, its Description stays empty.
 */
export async function copyIssueDescriptions(itemIds: string[]): Promise<CopyResult> {
  return fillFromGithub(itemIds);
}

/**
 * Re-pull (Ashu, 2026-11-09): the same fill, run again later for initiatives that were pulled in before these fields existed or whose
 * issue was labelled afterwards. It only ever fills what is still empty (Description, Change Type, Focus Area), never replaces a
 * value, and takes the labels live from GitHub when it reports them, from the Incoming record otherwise.
 */
export async function refreshPulledFromGithub(itemIds: string[]): Promise<CopyResult> {
  return fillFromGithub(itemIds);
}

async function fillFromGithub(itemIds: string[]): Promise<CopyResult> {
  const ids = [...new Set(itemIds)].filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
  if (ids.length === 0) return { copied: 0, failed: 0 };
  const { supabase, user, active } = await requireWorkspace("/incoming");
  if (active.platform || !["creator", "admin"].includes(active.role)) return { copied: 0, failed: ids.length };
  const sc = githubSourceControl();
  const { data: conn } = await supabase.from("github_connections").select("*").eq("tenant_id", active.tenantId).eq("state", "connected").maybeSingle();
  const c = conn as ConnectionRow | null;
  if (!sc || !c || c.installation_id === null) return { copied: 0, failed: ids.length };

  const [{ data: items }, { data: links }, { data: records }] = await Promise.all([
    supabase.from("items").select("id, source, description").eq("tenant_id", active.tenantId).is("deleted_at", null).in("id", ids),
    supabase.from("item_github_links").select("item_id, repo_full_name, issue_number").eq("tenant_id", active.tenantId).eq("connection_id", c.id).not("issue_number", "is", null).in("item_id", ids),
    supabase.from("tracker_issues").select("item_id, labels").eq("tenant_id", active.tenantId).eq("connection_id", c.id).in("item_id", ids),
  ]);
  const labelsOf = new Map(((records ?? []) as { item_id: string; labels: string[] | null }[]).map((r) => [r.item_id, r.labels ?? []]));
  const todo = ((items ?? []) as { id: string; source: string | null; description: string | null }[]).filter((i) => (i.source ?? "").startsWith("GitHub issue #"));
  const linkOf = new Map(((links ?? []) as { item_id: string; repo_full_name: string; issue_number: number }[]).map((l) => [l.item_id, l]));
  const admin = createAdminClient({ via: "UI" });
  const installation = c.installation_id;
  let copied = 0;
  let labelled = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < todo.length; i = next++) {
      const item = todo[i]!;
      const link = linkOf.get(item.id);
      if (!link) { failed++; continue; }
      const needsBody = !(item.description ?? "").trim();
      let issue: Awaited<ReturnType<typeof sc.getIssue>> = null;
      let unreadable = false;
      try { issue = await sc.getIssue(installation, link.repo_full_name, link.issue_number); } catch (e) {
        unreadable = true;
        console.error(JSON.stringify({ github: "copy-description", error: e instanceof Error ? e.message.slice(0, 120) : "unknown" }));
      }
      // Change Type and Focus Area: the labels GitHub shows now, else the Incoming record's; only empty fields are ever filled
      const fromLabels = labelFields(issue?.labels ?? labelsOf.get(item.id));
      if (fromLabels.changeType || fromLabels.focusArea) {
        const { data, error } = await admin.rpc("github_copy_issue_labels", { p_actor: user.id, p_item: item.id, p_change_type: fromLabels.changeType ?? null, p_focus_area: fromLabels.focusArea ?? null });
        if (!error && data && Object.keys(data as object).length > 0) labelled++;
      }
      if (!needsBody) continue; // a Description is never replaced
      if (unreadable || !issue) { failed++; continue; }
      const body = issue.body ?? "";
      if (body.includes(BLOCK_START)) continue; // written by Product Velocity: nothing to take over
      const text = receivedValue("description", body);
      if (!text) continue; // an issue without a body has nothing to copy
      const { data, error } = await admin.rpc("github_copy_issue_description", { p_actor: user.id, p_item: item.id, p_text: text });
      if (error) failed++;
      else if (data === true) copied++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return { copied, failed, labelled, checked: todo.length };
}
