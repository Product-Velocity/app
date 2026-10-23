import "server-only";
import type { IssueEvent, IssueSummary, SourceControl } from "@pv/github";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ConnectionRow } from "./server";

type Admin = ReturnType<typeof createAdminClient>;
export type Applied = { item_id: string; stale: boolean; changes: Record<string, [unknown, unknown]> } | null;
export type IngestResult = "duplicate" | "ignored" | "processed" | "error";

/** What the database needs to apply an issue's state, from either a delivery or a reconciliation. */
export type IssueFacts = { repo: string; number: number; issueId: number; nodeId: string; state: "open" | "closed"; stateReason: string | null; updatedAt: string };

const short = (e: unknown) => (e instanceof Error ? e.message : "unknown error").slice(0, 280);

async function applyFacts(admin: Admin, connectionId: string, f: IssueFacts): Promise<Applied> {
  const { data, error } = await admin.rpc("github_apply_issue", { p_connection: connectionId, p_repo: f.repo, p_number: f.number, p_issue_id: f.issueId, p_node_id: f.nodeId, p_state: f.state, p_state_reason: f.stateReason, p_updated_at: f.updatedAt });
  if (error) throw new Error(error.message);
  return data as Applied;
}

const factsOf = (s: Record<string, unknown>): IssueFacts => s as unknown as IssueFacts;

/**
 * Stores and applies one `issues` delivery. Deliveries that do not touch a linked item are not stored at all (the app repo
 * alone produces plenty). The delivery id makes replays harmless: a second copy is reported as "duplicate" and changes nothing.
 */
export async function ingestIssueEvent(admin: Admin, ev: IssueEvent, deliveryId: string): Promise<IngestResult> {
  const { data: conn } = await admin.from("github_connections").select("id, tenant_id").eq("installation_id", ev.installationId).eq("state", "connected").maybeSingle();
  if (!conn) return "ignored";
  const { data: link } = await admin.from("item_github_links").select("id, item_id").eq("connection_id", conn.id).ilike("repo_full_name", ev.repo).eq("issue_number", ev.number).maybeSingle();
  if (!link) return "ignored";

  const summary: IssueFacts = { repo: ev.repo, number: ev.number, issueId: ev.issueId, nodeId: ev.nodeId, state: ev.state, stateReason: ev.stateReason, updatedAt: ev.updatedAt };
  const { data: row, error: insertError } = await admin
    .from("sync_events")
    .insert({ tenant_id: conn.tenant_id, connection_id: conn.id, delivery_id: deliveryId, source: "webhook", event: "issues", action: ev.action, repo_full_name: ev.repo, issue_number: ev.number, summary, item_id: link.item_id })
    .select("id")
    .single();
  if (insertError) return insertError.code === "23505" ? "duplicate" : (() => { throw new Error(insertError.message); })();

  try {
    const applied = await applyFacts(admin, conn.id, summary);
    await admin.from("sync_events").update({ state: "processed", attempts: 1, processed_at: new Date().toISOString(), applied: applied?.changes ?? null }).eq("id", row.id);
    return "processed";
  } catch (e) {
    await admin.from("sync_events").update({ state: "error", attempts: 1, last_error: short(e) }).eq("id", row.id);
    return "error";
  }
}

/** Runs an event that failed (or was never finished) again. Safe to repeat: applying the same state changes nothing. */
export async function retryEvent(admin: Admin, tenantId: string, eventId: string): Promise<boolean> {
  const { data: ev } = await admin.from("sync_events").select("id, connection_id, summary, attempts, state").eq("id", eventId).eq("tenant_id", tenantId).maybeSingle();
  if (!ev || ev.state === "processed") return false;
  try {
    const applied = await applyFacts(admin, ev.connection_id, factsOf(ev.summary as Record<string, unknown>));
    await admin.from("sync_events").update({ state: "processed", attempts: ev.attempts + 1, processed_at: new Date().toISOString(), last_error: null, applied: applied?.changes ?? null }).eq("id", ev.id);
    return true;
  } catch (e) {
    await admin.from("sync_events").update({ state: "error", attempts: ev.attempts + 1, last_error: short(e) }).eq("id", ev.id);
    return false;
  }
}

export type ReconcileResult = { checked: number; changed: number; missing: number; repos: number };

/**
 * Compares GitHub with every linked item of the connection and applies what differs. This repairs missed or failed deliveries and
 * gives a newly linked issue its first state. Anything that changed is written to the sync log with the source "reconcile".
 */
export async function reconcileConnection(admin: Admin, sc: SourceControl, connection: ConnectionRow): Promise<ReconcileResult> {
  if (connection.installation_id === null) return { checked: 0, changed: 0, missing: 0, repos: 0 };
  const { data: links } = await admin.from("item_github_links").select("id, item_id, repo_full_name, issue_number").eq("connection_id", connection.id).not("issue_number", "is", null);
  const byRepo = new Map<string, { id: string; item_id: string; number: number }[]>();
  for (const l of (links ?? []) as { id: string; item_id: string; repo_full_name: string; issue_number: number }[]) byRepo.set(l.repo_full_name, [...(byRepo.get(l.repo_full_name) ?? []), { id: l.id, item_id: l.item_id, number: l.issue_number }]);

  const result: ReconcileResult = { checked: 0, changed: 0, missing: 0, repos: byRepo.size };
  for (const [repo, repoLinks] of byRepo) {
    const issues = new Map<number, IssueSummary>((await sc.listIssues(connection.installation_id, repo)).map((i) => [i.number, i]));
    for (const l of repoLinks) {
      result.checked++;
      const issue = issues.get(l.number);
      if (!issue) {
        result.missing++;
        await admin.from("item_github_links").update({ sync_state: "error", last_error: "The GitHub issue was not found (deleted or moved)." }).eq("id", l.id);
        continue;
      }
      const facts: IssueFacts = { repo, number: issue.number, issueId: issue.id, nodeId: issue.nodeId, state: issue.state, stateReason: issue.stateReason, updatedAt: issue.updatedAt };
      const applied = await applyFacts(admin, connection.id, facts);
      if (applied && Object.keys(applied.changes).length > 0) {
        result.changed++;
        await admin.from("sync_events").insert({ tenant_id: connection.tenant_id, connection_id: connection.id, delivery_id: `reconcile-${crypto.randomUUID()}`, source: "reconcile", event: "issues", action: "reconciled", repo_full_name: repo, issue_number: issue.number, summary: facts, item_id: l.item_id, state: "processed", attempts: 1, processed_at: new Date().toISOString(), applied: applied.changes });
      }
    }
  }
  return result;
}
