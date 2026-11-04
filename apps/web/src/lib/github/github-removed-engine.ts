import "server-only";
import type { SourceControl } from "@pv/github";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RemovedCtx } from "@/lib/tracker/removed-gate";
import { addRemovedLabel, closeNotPlanned, readCloseState, stateWords, type CloseState, type Target } from "./github-close";
import type { RemovedCard, RemovedList, RemovedResult } from "./push-types";
import { githubSourceControl } from "./server";

// "Removed in Product Velocity" on the server (decision 2026-11-03-github-close-removed; the twin of lib/atlassian/jira-removed-engine.ts). An initiative that
// was deleted sits in the Trash (items.deleted_at) and never touched GitHub. For each one in the Trash whose GitHub link is in mode `push` (Product Velocity
// owns the issue, for example the tracking issue it created) and that was not handled yet, `listRemoved` reads the issue (open or closed) so the preview can
// say what will happen; `closeOne` writes ONE initiative after the person confirmed: it reads GitHub again, adds the label `pv:removed`, closes the issue as
// "not planned" and records that it was handled. NEVER for a link in mode `follow` (the issue is only followed), never for an initiative that is not in the
// Trash, never a delete, never a reopen. Claude and service accounts never reach this code: the server action refuses them before (github-removed.ts) and the
// database function refuses them again. The columns of migration github_close_removed are read apart from everything else: a database that does not have them
// yet offers nothing (it cannot remember what it did), and the rest of the app is unaffected.

const LIMIT = 25;
const IN_CHUNK = 100;
type Link = { item_id: string; connection_id: string; repo_full_name: string; issue_number: number; html_url: string | null };
type Conn = { id: string; installation_id: number | null; state: string };
type Repo = { full_name: string; access: string; removed_at: string | null };
type Candidate = { id: string; code: string; name: string; /** The issue was adopted from GitHub ("PV takes ownership"), not created by Product Velocity: closing it ends real work there. */ adopted: boolean; link: Link; conn: Conn | null; repo: Repo | null };
const chunk = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** The Trash entries that Product Velocity may close in GitHub, newest first, or null when the database cannot remember handling them yet (migration not applied). */
async function candidates(ctx: RemovedCtx, only?: string): Promise<{ list: Candidate[]; total: number } | { error: string } | null> {
  const { data: trashed, error } = await ctx.supabase.rpc("trashed_items", { p_tenant: ctx.tenantId }); // creators and admins only; deleted rows are invisible to every other read
  if (error) return { error: "The Trash could not be read." };
  const rows = ((trashed ?? []) as { id: string; item_code: string; initiative_name: string }[]).filter((t) => !only || t.id === only);
  if (rows.length === 0) return { list: [], total: 0 };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const links: Link[] = [];
  const handled = new Set<string>();
  for (const part of chunk(rows.map((r) => r.id), IN_CHUNK)) {
    const { data } = await ctx.supabase.from("item_github_links").select("item_id, connection_id, repo_full_name, issue_number, html_url").eq("tenant_id", ctx.tenantId).eq("mode", "push").not("issue_number", "is", null).in("item_id", part);
    links.push(...((data ?? []) as Link[]));
    // apart from the rest: no column yet means nothing can be remembered, so nothing is offered
    const flags = await ctx.supabase.from("item_github_links").select("item_id, removed_handled_at").eq("tenant_id", ctx.tenantId).eq("mode", "push").in("item_id", part);
    if (flags.error) return null;
    for (const f of (flags.data ?? []) as { item_id: string; removed_handled_at: string | null }[]) if (f.removed_handled_at) handled.add(f.item_id);
  }
  const open = links.filter((l) => !handled.has(l.item_id) && byId.has(l.item_id));
  const order = new Map(rows.map((r, i) => [r.id, i]));
  open.sort((a, b) => order.get(a.item_id)! - order.get(b.item_id)!);
  const shown = only ? open : open.slice(0, LIMIT);
  if (shown.length === 0) return { list: [], total: open.length };
  const [conns, repos] = await Promise.all([
    ctx.supabase.from("github_connections").select("id, installation_id, state").eq("tenant_id", ctx.tenantId),
    ctx.supabase.from("github_repositories").select("connection_id, full_name, access, removed_at").eq("tenant_id", ctx.tenantId),
  ]);
  // adopted initiatives are made by the pull-in with source "GitHub issue #N" (and then switched to ownership); a deleted row is invisible to the person's own reads,
  // so this one narrow read uses the server client, tenant-scoped
  const { data: srcs } = await createAdminClient({ via: "UI" }).from("items").select("id, source").eq("tenant_id", ctx.tenantId).in("id", shown.map((l) => l.item_id));
  const adoptedIds = new Set(((srcs ?? []) as { id: string; source: string | null }[]).filter((r) => typeof r.source === "string" && r.source.startsWith("GitHub issue ")).map((r) => r.id));
  const list = shown.map((l): Candidate => {
    const t = byId.get(l.item_id)!;
    const repo = ((repos.data ?? []) as (Repo & { connection_id: string })[]).find((r) => r.connection_id === l.connection_id && r.full_name.toLowerCase() === l.repo_full_name.toLowerCase()) ?? null;
    return { id: l.item_id, code: t.item_code, name: t.initiative_name, adopted: adoptedIds.has(l.item_id), link: l, conn: ((conns.data ?? []) as Conn[]).find((c) => c.id === l.connection_id) ?? null, repo };
  });
  return { list, total: open.length };
}

const issueKey = (c: Candidate) => `${c.link.repo_full_name}#${c.link.issue_number}`;
const urlOf = (c: Candidate) => c.link.html_url ?? `https://github.com/${c.link.repo_full_name}/issues/${c.link.issue_number}`;
/** Why nothing may be written for this one, or null. The same boundaries as a push: connected, and a repository the app may write to. */
const usable = (c: Candidate): string | null => {
  if (!c.conn || c.conn.installation_id === null || c.conn.state === "disconnected" || c.conn.state === "requested" || c.conn.state === "waiting_approval" || c.conn.state === "installing") return "GitHub is not connected for this workspace.";
  if (c.conn.state === "suspended") return "The GitHub App is suspended for this account. A workspace admin can resume it on GitHub or sign in again under Settings > Integrations > GitHub.";
  if (!c.repo || c.repo.removed_at) return `${c.link.repo_full_name} is no longer available through the GitHub connection.`;
  if (c.repo.access === "read_only") return `${c.link.repo_full_name} is marked read-only in Settings > GitHub: the app never writes to it.`;
  return null;
};
const target = (c: Candidate, sc: SourceControl): Target => ({ sc, installationId: c.conn!.installation_id!, repo: c.link.repo_full_name, number: c.link.issue_number });

function card(c: Candidate, s: CloseState | null, why: string | null): RemovedCard {
  const base = { tracker: "github" as const, id: c.id, code: c.code, name: c.name, ...(c.adopted ? { adopted: true as const } : {}), issueKey: issueKey(c), issueUrl: urlOf(c), options: [] as RemovedCard["options"], defaultTransitionId: null as string | null };
  if (why) return { ...base, state: "error", message: why };
  if (!s) return { ...base, state: "error", message: "GitHub could not be read just now. Try again in a minute." };
  if (!s.ok) return { ...base, state: s.kind === "gone" ? "gone" : "error", message: s.message };
  return { ...base, state: "ready", trackerStatus: stateWords(s.state, s.stateReason), alreadyDone: s.state === "closed" };
}

/** What the preview shows: the removed initiatives of the workspace that can be closed in GitHub, each with what GitHub says now. Reads only; writes nothing. */
export async function listRemoved(ctx: RemovedCtx, deps: { sc?: SourceControl | null } = {}): Promise<RemovedList> {
  const found = await candidates(ctx);
  if (found === null) return { ok: true, items: [], more: 0 };
  if ("error" in found) return { ok: false, error: found.error };
  const sc = deps.sc === undefined ? githubSourceControl() : deps.sc;
  const items: RemovedCard[] = [];
  let stop: string | null = null; // a lost sign-in is shown once and stops the reading: nothing loops
  for (const part of chunk(found.list, 5)) {
    items.push(...(await Promise.all(part.map(async (c) => {
      const why = stop ?? usable(c) ?? (sc ? null : "The GitHub App is not set up for this deployment yet.");
      if (why || !sc) return card(c, null, why);
      const s = await readCloseState(target(c, sc));
      if (!s.ok && s.kind === "reconnect") stop = s.message;
      return card(c, s, null);
    }))));
  }
  return { ok: true, items, more: Math.max(0, found.total - found.list.length) };
}

/**
 * Closes ONE removed initiative's issue after the person confirmed. Reads the issue again first. Order: label, then the close, then the record; the record is
 * made only when the work is complete, so a refusal is shown and the initiative stays on the list (Try again re-adds the same label, which changes nothing).
 */
export async function closeOne(ctx: RemovedCtx, id: string, deps: { sc?: SourceControl | null; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ result: RemovedResult }> {
  const found = await candidates(ctx, id);
  const fail = (code: string, message: string, c?: Candidate): { result: RemovedResult } => ({ result: { id, code, outcome: "error", message, ...(c ? { issueLabel: issueKey(c), issueUrl: urlOf(c) } : {}) } });
  if (found === null) return fail("", "Product Velocity cannot remember what it closes yet: the database update (migration github_close_removed) is not applied. Nothing was written.");
  if ("error" in found) return fail("", found.error);
  const c = found.list[0];
  if (!c) return fail("", "This initiative is not in the Trash, its GitHub issue is only followed, or it was handled already. Nothing was written.");
  const refused = usable(c);
  if (refused) return fail(c.code, refused, c);
  const sc = deps.sc === undefined ? githubSourceControl() : deps.sc;
  if (!sc) return fail(c.code, "The GitHub App is not set up for this deployment yet.", c);
  const t = target(c, sc);
  const ref = { issueLabel: issueKey(c), issueUrl: urlOf(c) };
  const admin = createAdminClient({ via: "UI" });
  const record = async (result: "closed" | "already_done" | "not_found") => {
    const { error } = await admin.rpc("github_record_removed", { p_actor: ctx.userId, p_item: id, p_result: result, p_reason: result === "closed" ? "not_planned" : null });
    return !error;
  };
  const savedLater = "GitHub was updated, but Product Velocity could not record it. Try again: it will find the issue already done.";

  const s = await readCloseState(t, deps.sleep);
  if (!s.ok) {
    if (s.kind === "gone") return (await record("not_found")) ? { result: { id, code: c.code, outcome: "not_found", message: "GitHub no longer has this issue (or it is not visible to the app): there is nothing to close.", ...ref } } : fail(c.code, s.message, c);
    return fail(c.code, s.message, c);
  }
  const label = await addRemovedLabel(t, deps.sleep);
  if (!label.ok) return fail(c.code, label.message, c);
  if (s.state === "closed") {
    return (await record("already_done")) ? { result: { id, code: c.code, outcome: "already_done", message: `The issue was already closed (${stateWords(s.state, s.stateReason)}). The label pv:removed was added.`, ...ref } } : fail(c.code, savedLater, c);
  }
  const closed = await closeNotPlanned(t, s, deps.sleep);
  if (!closed.ok) return fail(c.code, `The label pv:removed was added, but the issue was not closed. ${closed.message}`, c);
  return (await record("closed")) ? { result: { id, code: c.code, outcome: "closed", message: "Closed as not planned and labelled pv:removed.", ...ref } } : fail(c.code, savedLater, c);
}
