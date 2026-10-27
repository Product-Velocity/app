import "server-only";
import { countBlockedStale } from "@pv/domain";
import { readIssueTree, summariseTree, type IssueEvent, type IssueSummary, type SourceControl, type SubIssueEvent } from "@pv/github";
import type { createAdminClient } from "@/lib/supabase/admin";
import { syncBoardStatuses } from "./board-sync";
import { newExtrasCache, refreshExtras, type ExtrasCache } from "./extras";
import type { ConnectionRow } from "./server";

type Admin = ReturnType<typeof createAdminClient>;
export type Applied = { item_id: string; stale: boolean; changes: Record<string, [unknown, unknown]> } | null;
export type IngestResult = "duplicate" | "ignored" | "processed" | "error";

/** What the database needs to apply an issue's state, from either a delivery or a reconciliation. */
export type IssueFacts = { repo: string; number: number; issueId: number; nodeId: string; state: "open" | "closed"; stateReason: string | null; updatedAt: string; closedAt?: string | null };

const short = (e: unknown) => (e instanceof Error ? e.message : "unknown error").slice(0, 280);

export async function applyFacts(admin: Admin, connectionId: string, f: IssueFacts): Promise<Applied> {
  const { data, error } = await admin.rpc("github_apply_issue", { p_connection: connectionId, p_repo: f.repo, p_number: f.number, p_issue_id: f.issueId, p_node_id: f.nodeId, p_state: f.state, p_state_reason: f.stateReason, p_updated_at: f.updatedAt });
  if (error) throw new Error(error.message);
  const applied = data as Applied;
  // when the ticket closed is Build Completed; reopening clears it. Older information (stale) never moves it.
  if (applied && !applied.stale) {
    const { error: e2 } = await admin.from("item_github_links").update({ gh_closed_at: f.state === "closed" ? (f.closedAt ?? f.updatedAt) : null }).eq("item_id", applied.item_id);
    if (e2) throw new Error(e2.message);
  }
  return applied;
}

/**
 * Rebuilds the epics-and-tasks tree of one linked initiative from GitHub and stores it with the delivery counts.
 * Returns false when GitHub offers no sub-issues for the issue. Never throws into a delivery: the daily reconcile repairs a miss.
 */
export async function refreshTree(admin: Admin, sc: SourceControl, installationId: number, connectionId: string, link: { item_id: string; repo: string; number: number }, cache?: ExtrasCache): Promise<boolean> {
  try {
    const tree = await readIssueTree(sc, installationId, link.repo, link.number);
    if (tree === null) return false;
    const s = summariseTree(tree);
    const nodes = tree.map((n) => ({ repo: n.repo, number: n.number, id: n.id, parent: n.parentNumber, level: n.level, title: n.title, state: n.state, reason: n.stateReason, closed_at: n.closedAt, assignees: n.assignees, created_by: n.createdBy }));
    const { error } = await admin.rpc("github_apply_tree", { p_connection: connectionId, p_item: link.item_id, p_nodes: nodes, p_total: s.total, p_closed: s.closed, p_pct: s.progressPct });
    if (error) throw new Error(error.message);
    // blocked and stale child issues, counted once here (the rule is in @pv/domain); the daily check refreshes them as time passes
    const bs = countBlockedStale(tree.map((n) => ({ state: n.state, updatedAt: n.updatedAt, labels: n.labels })), new Date());
    const { error: e2 } = await admin.rpc("github_apply_tree_counts", { p_connection: connectionId, p_item: link.item_id, p_blocked: bs.blocked, p_stale: bs.stale });
    if (e2) throw new Error(e2.message);
    // pull requests, checks, releases and repositories of the same initiative; never fails the tree
    await refreshExtras(admin, sc, installationId, connectionId, link.item_id, cache);
    return true;
  } catch (e) {
    console.error(JSON.stringify({ github: "tree", error: short(e) }));
    return false;
  }
}

/** A `sub_issues` delivery: the parent changed, so its tree is read again. */
export async function ingestSubIssueEvent(admin: Admin, sc: SourceControl, ev: SubIssueEvent): Promise<IngestResult> {
  const { data: conn } = await admin.from("github_connections").select("id").eq("installation_id", ev.installationId).eq("state", "connected").maybeSingle();
  if (!conn) return "ignored";
  const { data: link } = await admin.from("item_github_links").select("item_id").eq("connection_id", conn.id).ilike("repo_full_name", ev.repo).eq("issue_number", ev.parentNumber).maybeSingle();
  if (!link) return "ignored";
  return (await refreshTree(admin, sc, ev.installationId, conn.id, { item_id: link.item_id, repo: ev.repo, number: ev.parentNumber })) ? "processed" : "ignored";
}

type LightIssue = { number: number; id: number; title?: string; issueType?: string | null; labels?: string[]; state: "open" | "closed"; stateReason: string | null; htmlUrl?: string | null; parentNumber?: number | null; updatedAt: string };

/** Records issues that are not part of an initiative as Not pulled (or Ignored by a saved rule, or Pulled when one already follows them). */
export async function recordIncoming(admin: Admin, connectionId: string, repo: string, issues: LightIssue[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < issues.length; i += 200) {
    const rows = issues.slice(i, i + 200).filter((x) => x.title !== undefined).map((x) => ({ repo, number: x.number, id: x.id, title: x.title, type: x.issueType ?? null, labels: x.labels ?? [], state: x.state, reason: x.stateReason, parent: x.parentNumber ?? null, url: x.htmlUrl ?? null, updated_at: x.updatedAt }));
    if (rows.length === 0) continue;
    const { data, error } = await admin.rpc("tracker_upsert_issues", { p_connection: connectionId, p_rows: rows });
    if (error) throw new Error(error.message);
    n += Number(data ?? 0);
  }
  return n;
}

const factsOf = (s: Record<string, unknown>): IssueFacts => s as unknown as IssueFacts;

/**
 * Stores and applies one `issues` delivery. Deliveries that do not touch a linked item are not stored at all (the app repo
 * alone produces plenty). The delivery id makes replays harmless: a second copy is reported as "duplicate" and changes nothing.
 */
export async function ingestIssueEvent(admin: Admin, ev: IssueEvent, deliveryId: string, sc?: SourceControl): Promise<IngestResult> {
  const { data: conn } = await admin.from("github_connections").select("id, tenant_id").eq("installation_id", ev.installationId).eq("state", "connected").maybeSingle();
  if (!conn) return "ignored";
  const { data: link } = await admin.from("item_github_links").select("id, item_id").eq("connection_id", conn.id).ilike("repo_full_name", ev.repo).eq("issue_number", ev.number).maybeSingle();
  if (!link) {
    // an epic or task under a linked initiative: its progress counts move, so the parent's tree is read again
    const { data: node } = await admin.from("item_issue_tree").select("item_id").eq("tenant_id", conn.tenant_id).ilike("repo_full_name", ev.repo).eq("issue_number", ev.number).limit(1).maybeSingle();
    if (!node) {
      // a stranger to every initiative: keep the light record for the Incoming list (never stored as a sync event)
      if (["deleted", "transferred"].includes(ev.action)) return "ignored";
      await recordIncoming(admin, conn.id, ev.repo, [{ number: ev.number, id: ev.issueId, title: ev.title, issueType: ev.issueType, labels: ev.labels, state: ev.state, stateReason: ev.stateReason, htmlUrl: ev.htmlUrl, parentNumber: ev.parentNumber, updatedAt: ev.updatedAt }]);
      return "processed";
    }
    if (!sc) return "ignored";
    const { data: parent } = await admin.from("item_github_links").select("repo_full_name, issue_number").eq("item_id", node.item_id).maybeSingle();
    if (!parent?.issue_number) return "ignored";
    return (await refreshTree(admin, sc, ev.installationId, conn.id, { item_id: node.item_id, repo: parent.repo_full_name, number: parent.issue_number })) ? "processed" : "ignored";
  }

  const summary: IssueFacts = { repo: ev.repo, number: ev.number, issueId: ev.issueId, nodeId: ev.nodeId, state: ev.state, stateReason: ev.stateReason, updatedAt: ev.updatedAt, closedAt: ev.closedAt };
  const { data: row, error: insertError } = await admin
    .from("sync_events")
    .insert({ tenant_id: conn.tenant_id, connection_id: conn.id, delivery_id: deliveryId, source: "webhook", event: "issues", action: ev.action, repo_full_name: ev.repo, issue_number: ev.number, summary, item_id: link.item_id })
    .select("id")
    .single();
  if (insertError) return insertError.code === "23505" ? "duplicate" : (() => { throw new Error(insertError.message); })();

  try {
    const applied = await applyFacts(admin, conn.id, summary);
    await admin.from("sync_events").update({ state: "processed", attempts: 1, processed_at: new Date().toISOString(), applied: applied?.changes ?? null }).eq("id", row.id);
    if (sc) await refreshTree(admin, sc, ev.installationId, conn.id, { item_id: link.item_id, repo: ev.repo, number: ev.number });
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
  const listed = new Map<string, IssueSummary[]>();
  const treeJobs: { item_id: string; repo: string; number: number }[] = [];
  for (const [repo, repoLinks] of byRepo) {
    const all = await sc.listIssues(connection.installation_id, repo);
    listed.set(repo.toLowerCase(), all);
    const issues = new Map<number, IssueSummary>(all.map((i) => [i.number, i]));
    const one = async (l: { id: string; item_id: string; number: number }) => {
      result.checked++;
      const issue = issues.get(l.number);
      if (!issue) {
        result.missing++;
        await admin.from("item_github_links").update({ sync_state: "error", last_error: "The GitHub issue was not found (deleted or moved)." }).eq("id", l.id);
        return;
      }
      const facts: IssueFacts = { repo, number: issue.number, issueId: issue.id, nodeId: issue.nodeId, state: issue.state, stateReason: issue.stateReason, updatedAt: issue.updatedAt, closedAt: issue.closedAt };
      const applied = await applyFacts(admin, connection.id, facts);
      if (applied && Object.keys(applied.changes).length > 0) {
        result.changed++;
        await admin.from("sync_events").insert({ tenant_id: connection.tenant_id, connection_id: connection.id, delivery_id: `reconcile-${crypto.randomUUID()}`, source: "reconcile", event: "issues", action: "reconciled", repo_full_name: repo, issue_number: issue.number, summary: facts, item_id: l.item_id, state: "processed", attempts: 1, processed_at: new Date().toISOString(), applied: applied.changes });
      }
      treeJobs.push({ item_id: l.item_id, repo, number: l.number });
    };
    // several linked items at a time: each one is a few round trips to the database, and 30 in a row is slow
    for (let i = 0; i < repoLinks.length; i += 6) await Promise.all(repoLinks.slice(i, i + 6).map(one));
  }
  // every other issue of the repositories the App can read: the Incoming list (Not pulled unless a saved rule or a link says otherwise)
  const { data: repos } = await admin.from("github_repositories").select("full_name").eq("connection_id", connection.id).is("removed_at", null);
  for (const r of (repos ?? []) as { full_name: string }[]) {
    const all = listed.get(r.full_name.toLowerCase()) ?? (await sc.listIssues(connection.installation_id, r.full_name));
    await recordIncoming(admin, connection.id, r.full_name, all);
  }
  // epics and tasks: several issues at a time, so a workspace with many linked items stays inside the time limit of the request
  const extrasCache = newExtrasCache(); // each repository's checks and releases are read once for the whole pass
  for (let i = 0; i < treeJobs.length; i += 6) {
    await Promise.all(treeJobs.slice(i, i + 6).map((j) => refreshTree(admin, sc, connection.installation_id!, connection.id, j, extrasCache)));
  }
  return result;
}

/** A full check that always leaves its outcome on the connection (shown in Settings > GitHub), whether it worked or not. */
export async function runCheck(admin: Admin, sc: SourceControl, connection: ConnectionRow): Promise<ReconcileResult | null> {
  try {
    const r = await reconcileConnection(admin, sc, connection);
    // the board's Status of every linked board (Delivery Status); a board that fails must not fail the check
    const board = await syncBoardStatuses(admin, sc, connection).catch((e) => { console.error(JSON.stringify({ github: "board-status", error: short(e) })); return null; });
    await admin.from("github_connections").update({ last_check_at: new Date().toISOString(), last_check_summary: `Checked ${r.checked} linked item(s): ${r.changed} changed, ${r.missing} issue(s) not found.${board?.boards ? ` Board status: ${board.updated} updated.` : ""}${board?.notes.length ? ` ${board.notes.join(" ")}` : ""}` }).eq("id", connection.id);
    return r;
  } catch (e) {
    console.error(JSON.stringify({ github: "check", error: short(e) }));
    await admin.from("github_connections").update({ last_check_at: new Date().toISOString(), last_check_summary: `The check failed: ${short(e)}`.slice(0, 300) }).eq("id", connection.id);
    return null;
  }
}
