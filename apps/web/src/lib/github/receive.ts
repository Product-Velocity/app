import "server-only";
import type { SourceControl } from "@pv/github";
import type { createAdminClient } from "@/lib/supabase/admin";
import { syncBoardStatuses } from "./board-sync";
import type { ReceiveItem, ReceivedLine } from "./push-types";
import type { ConnectionRow } from "./server";
import { applyFacts, refreshTree, type IssueFacts } from "./sync";

type Admin = ReturnType<typeof createAdminClient>;

const CONCURRENCY = 5;
const GH_STATE: Record<string, string> = { open: "Open", closed_completed: "Closed as completed", closed_not_planned: "Closed as not planned" };
const LABEL: Record<string, string> = { gh_state: "GitHub State", status: "Build Status" };
const word = (key: string, v: unknown) => (v === null || v === undefined || v === "" ? null : key === "gh_state" ? (GH_STATE[String(v)] ?? String(v)) : String(v));
const short = (e: unknown) => (e instanceof Error ? e.message : "unknown error").slice(0, 200);

type LinkRow = { id: string; item_id: string; mode: "push" | "follow"; repo_full_name: string; issue_number: number | null; html_url: string | null };
type ItemRow = { id: string; item_code: string; initiative_name: string };

/**
 * Step 1 and 2 of "Sync with GitHub": reads GitHub for the chosen initiatives and applies what GitHub owns (the issue's state and
 * the Build Status that follows it, the epics and tasks with their progress, and the board's Status). It writes nothing to GitHub,
 * and nothing it reads can reach a field GitHub does not own: only the issue's state and counts are passed on, never its text.
 * One initiative failing never stops the others. The result lists every initiative, also those that are already in step.
 */
export async function receiveFromGithub(admin: Admin, sc: SourceControl, connection: ConnectionRow, ids: string[]): Promise<ReceiveItem[]> {
  const tenantId = connection.tenant_id;
  const installationId = connection.installation_id;
  const unique = [...new Set(ids)];
  const [{ data: items }, { data: links }] = await Promise.all([
    admin.from("items").select("id, item_code, initiative_name").eq("tenant_id", tenantId).is("deleted_at", null).in("id", unique),
    admin.from("item_github_links").select("id, item_id, mode, repo_full_name, issue_number, html_url").eq("tenant_id", tenantId).eq("connection_id", connection.id).in("item_id", unique),
  ]);
  const itemById = new Map(((items ?? []) as ItemRow[]).map((i) => [i.id, i]));
  const linkByItem = new Map(((links ?? []) as LinkRow[]).map((l) => [l.item_id, l]));

  const one = async (id: string): Promise<ReceiveItem> => {
    const item = itemById.get(id);
    if (!item) return { id, code: "", name: "", status: "error", received: [], issueNumber: null, issueUrl: null, message: "This initiative no longer exists or you cannot see it." };
    const link = linkByItem.get(id);
    const base = { id, code: item.item_code, name: item.initiative_name, ...(link?.mode === "follow" ? { readOnly: true } : {}) };
    if (!link || link.issue_number === null) return { ...base, status: "not_on_github", received: [], issueNumber: null, issueUrl: null };
    const where = { issueNumber: link.issue_number, issueUrl: link.html_url };
    if (!installationId) return { ...base, status: "error", received: [], ...where, message: "GitHub is not connected." };
    try {
      const issue = await sc.getIssue(installationId, link.repo_full_name, link.issue_number);
      if (!issue) {
        await admin.from("item_github_links").update({ sync_state: "error", last_error: "The GitHub issue was not found (deleted or moved)." }).eq("id", link.id);
        return { ...base, status: "missing", received: [], ...where, message: "The GitHub issue no longer exists (deleted or moved). Nothing is recreated: a person decides." };
      }
      const facts: IssueFacts = { repo: link.repo_full_name, number: issue.number, issueId: issue.id, nodeId: issue.nodeId, state: issue.state, stateReason: issue.stateReason ?? null, updatedAt: issue.updatedAt ?? new Date().toISOString(), closedAt: issue.closedAt ?? null };
      const applied = await applyFacts(admin, connection.id, facts);
      const received: ReceivedLine[] = [];
      if (applied && !applied.stale) {
        for (const [key, [from, to]] of Object.entries(applied.changes)) received.push({ label: LABEL[key] ?? key, from: word(key, from), to: word(key, to) });
        if (received.length > 0) {
          await admin.from("sync_events").insert({ tenant_id: tenantId, connection_id: connection.id, delivery_id: `reconcile-${crypto.randomUUID()}`, source: "reconcile", event: "issues", action: "synced", repo_full_name: link.repo_full_name, issue_number: issue.number, summary: facts, item_id: id, state: "processed", attempts: 1, processed_at: new Date().toISOString(), applied: applied.changes });
        }
      }
      await refreshTree(admin, sc, installationId, connection.id, { item_id: id, repo: link.repo_full_name, number: link.issue_number });
      // the check itself is what Last Synced shows, also when GitHub had nothing new
      await admin.from("item_github_links").update({ gh_synced_at: new Date().toISOString() }).eq("id", link.id);
      return { ...base, status: link.mode === "follow" && received.length === 0 ? "follows" : received.length > 0 ? "received" : "in_step", received, ...where };
    } catch (e) {
      console.error(JSON.stringify({ github: "receive", error: short(e) }));
      return { ...base, status: "error", received: [], ...where, message: `Could not read #${link.issue_number}: try again.` };
    }
  };

  const out: ReceiveItem[] = [];
  for (let i = 0; i < unique.length; i += CONCURRENCY) out.push(...(await Promise.all(unique.slice(i, i + CONCURRENCY).map(one))));

  // the board's Status once per board, not per initiative; a board that cannot be read is a note, never a failure
  if (installationId) {
    const before = new Map<string, string | null>();
    const linked = out.filter((r) => r.status !== "not_on_github" && r.status !== "error" && r.status !== "missing").map((r) => r.id);
    if (linked.length > 0) {
      const { data: cur } = await admin.from("items").select("id, gh_project_status").eq("tenant_id", tenantId).in("id", linked);
      for (const c of (cur ?? []) as { id: string; gh_project_status: string | null }[]) before.set(c.id, c.gh_project_status);
      try {
        await syncBoardStatuses(admin, sc, connection);
        const { data: after } = await admin.from("items").select("id, gh_project_status").eq("tenant_id", tenantId).in("id", linked);
        for (const a of (after ?? []) as { id: string; gh_project_status: string | null }[]) {
          if ((before.get(a.id) ?? null) === (a.gh_project_status ?? null)) continue;
          const r = out.find((x) => x.id === a.id)!;
          r.received.push({ label: "Delivery Status", from: before.get(a.id) ?? null, to: a.gh_project_status ?? null });
          if (r.status === "in_step" || r.status === "follows") r.status = "received";
        }
      } catch (e) {
        console.error(JSON.stringify({ github: "receive-board", error: short(e) }));
        for (const r of out) if (linked.includes(r.id)) r.message = r.message ?? "The board could not be read just now, so Delivery Status was left as it is.";
      }
    }
  }
  return out;
}
