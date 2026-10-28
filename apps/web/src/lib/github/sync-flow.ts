import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assigneeChange, BLOCK_END, BLOCK_START, compareAssignees, compareBoardValues, type AssigneeCompare, type Member, compareIssue, hashText, isBoardConflict, parseBoard, type BoardFieldCompare, type BoardKey, SYNC_FIELD_COLUMN, SYNC_FIELD_LABEL, SYNC_FIELD_LIMIT, SYNC_TEXT_FIELDS, type IssueCompare, type SourceControl, type SyncTextField } from "@pv/github";
import type { createAdminClient } from "@/lib/supabase/admin";
import { executePush, planPush } from "./push";
import type { PushItemResult, SyncChoice, SyncConfirmResult, SyncConflict, SyncPreview, TakenOver } from "./push-types";
import { receiveFromGithub, type IssueTexts } from "./receive";
import type { ConnectionRow } from "./server";

type Admin = ReturnType<typeof createAdminClient>;
export type SyncCtx = {
  supabase: SupabaseClient;
  /** Applies what GitHub owns (source: GitHub). */
  adminGithub: Admin;
  /** Writes made on behalf of the person who pressed the button (source: UI). */
  adminUi: Admin;
  sc: SourceControl;
  connection: ConnectionRow;
  tenantId: string;
  actor: string;
  appUrl: string;
};

type ItemCompare = {
  code: string; cmp: IssueCompare; blockHash: string; baseComplete: boolean; pvHashes: Record<SyncTextField, string>;
  /** Every board value compared (Priority, Initiative Group, Due date, Size), empty when the initiative is not on a board. */
  board: BoardFieldCompare[];
  /** The board values could not be read just now: nothing about them was compared. */
  boardError?: boolean;
  /** Every stored board hash already equals Product Velocity's. */
  boardBaseComplete: boolean;
  /** The tracking issue's assignees against the people assigned in Product Velocity, when the initiative has a pushed issue. */
  assignees?: { cmp: AssigneeCompare; ghLogins: string[]; repo: string; number: number; /** Assignees are only written to private repositories. */ writable: boolean; baseComplete: boolean };
};
type PvRow = { id: string; item_code: string; initiative_name: string; summary: string | null; description: string | null; hypothesis: string | null; moscow: string | null; theme: string | null; end_date: string | null; effort: string | null; home_project_id: string | null; assignee_ids: string[] | null };
type SyncBase = Partial<Record<SyncTextField | BoardKey | "assignees", string>>;
type BaseRow = { item_id: string; mode: string; sync_base: SyncBase | null; project_item_id: string | null; repo_full_name: string; issue_number: number | null };

const pvText = (r: PvRow): Record<SyncTextField, string> => ({ title: r.initiative_name ?? "", summary: r.summary ?? "", description: r.description ?? "", hypothesis: r.hypothesis ?? "" });
const pvHash = (f: SyncTextField, v: string) => hashText(v.trim().slice(0, SYNC_FIELD_LIMIT[f]));
/** The text between our markers, hashed, so an edit made elsewhere in the body does not count as a change of the block. */
function blockHashOf(body: string): string {
  const start = body.indexOf(BLOCK_START);
  const end = start === -1 ? -1 : body.indexOf(BLOCK_END, start);
  return hashText(start !== -1 && end !== -1 ? body.slice(start, end) : body);
}

/** Reads the title and body of the linked issues (fresh), for the confirm. An issue that cannot be read is left out. */
export async function readIssueTexts(sc: SourceControl, connection: ConnectionRow, links: { item_id: string; repo_full_name: string; issue_number: number }[]): Promise<Map<string, IssueTexts>> {
  const out = new Map<string, IssueTexts>();
  for (let i = 0; i < links.length; i += 5) {
    await Promise.all(links.slice(i, i + 5).map(async (l) => {
      const issue = await sc.getIssue(connection.installation_id!, l.repo_full_name, l.issue_number).catch(() => null);
      if (issue) out.set(l.item_id, { title: issue.title ?? "", body: issue.body, assignees: issue.assignees ?? [] });
    }));
  }
  return out;
}

/**
 * Three-way comparison for every initiative whose issue was read. The base is what was recorded at the last sync; for an initiative
 * linked before this existed, Product Velocity's text counts as the base when nothing changed there since the last send (`unchanged`),
 * and otherwise there is no base and any difference is a conflict, never a silent overwrite.
 */
async function compareItems(ctx: SyncCtx, ids: string[], issues: Map<string, IssueTexts>, unchanged: ReadonlySet<string>): Promise<{ compares: Map<string, ItemCompare>; error?: string }> {
  const [items, links, projects, groups, memberRows, directory, repoRows] = await Promise.all([
    ctx.supabase.from("items").select("id, item_code, initiative_name, summary, description, hypothesis, moscow, theme, end_date, effort, home_project_id, assignee_ids").eq("tenant_id", ctx.tenantId).is("deleted_at", null).in("id", ids),
    ctx.supabase.from("item_github_links").select("item_id, mode, sync_base, project_item_id, repo_full_name, issue_number").eq("tenant_id", ctx.tenantId).eq("connection_id", ctx.connection.id).in("item_id", ids),
    ctx.supabase.from("projects").select("id, github_board").eq("tenant_id", ctx.tenantId).not("github_board", "is", null),
    ctx.supabase.from("item_groups").select("name").eq("tenant_id", ctx.tenantId),
    ctx.supabase.from("tenant_members").select("user_id, github_username").eq("tenant_id", ctx.tenantId),
    ctx.supabase.rpc("tenant_directory", { p_tenant: ctx.tenantId }),
    ctx.supabase.from("github_repositories").select("full_name, is_private").eq("tenant_id", ctx.tenantId).eq("connection_id", ctx.connection.id).is("removed_at", null),
  ]);
  // a read that fails must never look like "in step": without these reads nothing can be compared
  const failed = items.error ?? links.error ?? projects.error ?? groups.error ?? memberRows.error ?? directory.error ?? repoRows.error;
  if (failed) {
    console.error(JSON.stringify({ github: "compare", error: failed.message.slice(0, 200) }));
    return { compares: new Map(), error: "The texts could not be compared with GitHub just now (the database refused the read). Nothing was sent. If this keeps happening, check that the latest database migration has been applied." };
  }
  const linkBy = new Map(((links.data ?? []) as BaseRow[]).map((l) => [l.item_id, l]));
  const boardOf = new Map(((projects.data ?? []) as { id: string; github_board: unknown }[]).map((p) => [p.id, parseBoard(p.github_board)]));
  const groupNames = ((groups.data ?? []) as { name: string }[]).map((g) => g.name);
  const emailOf = new Map(((directory.data ?? []) as { user_id: string; email: string }[]).map((d) => [d.user_id, d.email]));
  const members: Member[] = ((memberRows.data ?? []) as { user_id: string; github_username: string | null }[]).map((m) => ({ userId: m.user_id, login: m.github_username, label: emailOf.get(m.user_id) ?? "A member" }));
  const privateRepos = new Set(((repoRows.data ?? []) as { full_name: string; is_private: boolean | null }[]).filter((r) => r.is_private === true).map((r) => r.full_name.toLowerCase()));
  const out = new Map<string, ItemCompare>();
  // the board values of every initiative on a board, read in parallel (a read-only call per initiative)
  const boardValues = new Map<string, Awaited<ReturnType<SourceControl["getBoardItemValues"]>> | "error">();
  await Promise.all(((items.data ?? []) as PvRow[]).map(async (r) => {
    const link = linkBy.get(r.id);
    if (!link || link.mode !== "push" || !link.project_item_id || !issues.has(r.id) || !boardOf.get(r.home_project_id ?? "")) return;
    boardValues.set(r.id, await ctx.sc.getBoardItemValues(ctx.connection.installation_id!, link.project_item_id).catch(() => "error" as const));
  }));
  for (const r of (items.data ?? []) as PvRow[]) {
    const issue = issues.get(r.id);
    const link = linkBy.get(r.id);
    if (!issue || !link || link.mode !== "push") continue;
    const texts = pvText(r);
    const pvHashes = Object.fromEntries(SYNC_TEXT_FIELDS.map((f) => [f, pvHash(f, texts[f])])) as Record<SyncTextField, string>;
    const base: Partial<Record<SyncTextField, string>> = {};
    for (const f of SYNC_TEXT_FIELDS) {
      const recorded = link.sync_base?.[f];
      if (recorded) base[f] = recorded;
      else if (unchanged.has(r.id)) base[f] = pvHashes[f];
    }
    const cmp = compareIssue({ code: r.item_code, pv: r, issue, base });
    const values = boardValues.get(r.id);
    const board = values && values !== "error" ? compareBoardValues({ board: boardOf.get(r.home_project_id ?? "")!, pv: r, values, base: link.sync_base ?? undefined, pvUnchanged: unchanged.has(r.id), groups: groupNames }) : [];
    const asg = compareAssignees({ members, pvIds: r.assignee_ids ?? [], ghLogins: issue.assignees ?? [], ...(link.sync_base?.assignees ? { base: link.sync_base.assignees } : {}), pvUnchanged: unchanged.has(r.id) });
    out.set(r.id, {
      code: r.item_code, cmp, blockHash: blockHashOf(issue.body),
      ...(link.issue_number !== null ? { assignees: { cmp: asg, ghLogins: issue.assignees ?? [], repo: link.repo_full_name, number: link.issue_number, writable: privateRepos.has(link.repo_full_name.toLowerCase()), baseComplete: link.sync_base?.assignees === asg.pvHash } } : {}), baseComplete: SYNC_TEXT_FIELDS.every((f) => link.sync_base?.[f] === pvHashes[f]), pvHashes,
      board, boardBaseComplete: board.every((b) => link.sync_base?.[b.key] === b.pvHash), ...(values === "error" ? { boardError: true } : {}),
    });
  }
  return { compares: out };
}

const BLOCK_NOTE = "The managed block in GitHub was edited so that it cannot be read field by field. Keep Product Velocity rewrites the block; Keep GitHub leaves the issue as it is and sends nothing for this initiative.";

export function conflictsOf(c: ItemCompare | undefined): SyncConflict[] {
  if (!c) return [];
  const out: SyncConflict[] = [];
  for (const f of c.cmp.fields) {
    if (f.verdict !== "github" && f.verdict !== "both") continue;
    out.push({ field: f.field, label: SYNC_FIELD_LABEL[f.field], kind: f.verdict, pv: f.pvText, github: f.githubText, ghHash: f.ghHash, defaultChoice: f.verdict === "github" ? "pv" : null });
  }
  for (const b of c.board.filter(isBoardConflict)) {
    const emptyPv = b.pvText === "";
    const note = !b.pull ? b.pullNote : emptyPv ? "Product Velocity has no value here. Keep Product Velocity leaves the board as it is (nothing on a board is cleared)." : undefined;
    out.push({ field: b.key, label: b.label, kind: b.verdict as "github" | "both", pv: b.pvText || "(empty)", github: b.githubText, ghHash: b.ghHash, defaultChoice: !b.pull ? (b.verdict === "github" ? "pv" : null) : emptyPv ? "github" : b.verdict === "github" ? "pv" : null, where: "board", ...(b.pull ? {} : { githubPullable: false }), ...(note ? { note } : {}) });
  }
  const a = c.assignees;
  if (a && (a.cmp.verdict === "github" || a.cmp.verdict === "both")) {
    const notes = [
      a.cmp.ghUnmapped.length ? `Also assigned in GitHub and matched to nobody here (left as they are): ${a.cmp.ghUnmapped.map((l) => `@${l}`).join(", ")}.` : "",
      a.cmp.pvNoLogin.length ? `Without a GitHub username, so never written: ${a.cmp.pvNoLogin.join(", ")}.` : "",
    ].filter(Boolean);
    out.push({
      field: "assignees", label: "Assignees", kind: a.cmp.verdict, pv: a.cmp.pvText || "(nobody)", github: a.cmp.githubText || "(nobody)", ghHash: a.cmp.ghHash,
      defaultChoice: !a.writable ? "github" : a.cmp.pvText === "" ? "github" : a.cmp.verdict === "github" ? "pv" : null,
      ...(a.writable ? {} : { pvPossible: false as const }),
      ...(notes.length || !a.writable ? { note: [!a.writable ? "This repository is public, so Product Velocity never writes assignees to it." : "", ...notes].filter(Boolean).join(" ") } : {}),
    });
  }
  if (c.cmp.blockProblem) out.push({ field: "block", label: "Managed block", kind: "block", pv: "Rebuilt from Product Velocity", github: c.cmp.blockProblem, ghHash: c.blockHash, defaultChoice: null, note: BLOCK_NOTE });
  return out;
}

/** Remembers, as hashes, that both sides agree: after an "in step" comparison, a send or a pull. */
async function recordBase(ctx: SyncCtx, itemId: string, hashes: Partial<Record<SyncTextField | BoardKey, string>>) {
  const { error } = await ctx.adminUi.rpc("github_record_base", { p_actor: ctx.actor, p_item: itemId, p_base: hashes });
  if (error) console.error(JSON.stringify({ github: "record-base", error: error.message.slice(0, 200) }));
}

/** Steps 1 to 4: check GitHub, apply what it owns, compare the texts, work out the send. Writes nothing to GitHub; an initiative found in step has its base recorded. */
export async function buildSyncPreview(ctx: SyncCtx, ids: string[], opts: { board?: boolean } = {}): Promise<SyncPreview & { compares: Map<string, ItemCompare>; texts: Map<string, IssueTexts>; compareError?: string }> {
  const texts = new Map<string, IssueTexts>();
  const received = await receiveFromGithub(ctx.adminGithub, ctx.sc, ctx.connection, ids, texts, opts);
  const send = await planPush(ctx.supabase, ctx.tenantId, ctx.appUrl, ctx.connection, ids, ctx.sc);
  const { compares, error: compareError } = await compareItems(ctx, ids, texts, new Set(send.filter((p) => p.action === "unchanged").map((p) => p.id)));
  if (compareError) for (const r of received) if (r.status === "in_step" || r.status === "received" || r.status === "follows") { r.status = "error"; r.message = compareError; }
  for (const r of received) {
    const c = compares.get(r.id);
    const conflicts = conflictsOf(c);
    if (conflicts.length > 0) { r.conflicts = conflicts; if (r.status === "in_step" || r.status === "received") r.status = "conflict"; }
    else if (c && (!c.baseComplete || !c.boardBaseComplete || (c.assignees && !c.assignees.baseComplete && c.assignees.cmp.verdict === "none")) && c.cmp.fields.every((f) => f.verdict === "none") && c.board.every((b) => b.verdict === "none") && (!c.assignees || c.assignees.cmp.verdict === "none")) await recordBase(ctx, r.id, { ...c.pvHashes, ...Object.fromEntries(c.board.map((b) => [b.key, b.pvHash])), ...(c.assignees ? { assignees: c.assignees.cmp.pvHash } : {}) });
    // Product Velocity changed the assignees and GitHub did not: the send adds and removes these (private repositories only)
    if (c?.assignees?.cmp.verdict === "send") {
      if (c.assignees.writable) r.assigneeSend = assigneeChange(c.assignees.ghLogins, c.assignees.cmp.writeLogins);
      else r.message = r.message ?? "Assignees changed in Product Velocity are not written to a public repository.";
    }
    if (c?.boardError) r.message = r.message ?? "The board values (Priority, Initiative Group, Due date, Size) could not be read just now, so they were not compared.";
  }
  return { account: ctx.connection.account_login ?? ctx.connection.expected_account, received, send, compares, texts, ...(compareError ? { compareError } : {}) };
}

const strip = ({ account, received, send }: SyncPreview): SyncPreview => ({ account, received, send });

/**
 * Applies the person's choices and sends. Order: re-read GitHub; if anything differs from what the person saw, stop and return the
 * new difference (nothing applied, nothing sent); apply the texts they took from GitHub; send what Product Velocity owns; record the
 * new base for every initiative that is now in step. One initiative failing never stops the others, and leaves its base unchanged.
 */
export async function confirmSync(ctx: SyncCtx, ids: string[], choices: SyncChoice[]): Promise<SyncConfirmResult> {
  // the board was read when the dialog opened and is read again after the send, so the confirm skips it
  const pre = await buildSyncPreview(ctx, ids, { board: false });
  if (pre.compareError) return { ok: false, error: pre.compareError };
  // every conflict needs a choice, made on the text that is in GitHub now
  for (const r of pre.received) {
    for (const c of r.conflicts ?? []) {
      const pick = choices.find((x) => x.itemId === r.id && x.field === c.field);
      if (!pick || pick.ghHash !== c.ghHash) return { ok: false, error: "GitHub changed after you looked. Nothing was applied or sent: check the new difference and choose again.", stale: strip(pre) };
      if (pick.choice === "pv" && c.pvPossible === false) return { ok: false, error: `${c.label}: Product Velocity's value cannot be written to GitHub here (a public repository), so only Keep GitHub is possible. Nothing was applied or sent.`, stale: strip(pre) };
      if (pick.choice === "github" && c.githubPullable === false) return { ok: false, error: `${c.label}: the value on the board cannot be taken over into Product Velocity, so only Keep Product Velocity is possible. Nothing was applied or sent.`, stale: strip(pre) };
    }
  }

  const failed = new Map<string, string>();
  const results: PushItemResult[] = [];
  const taken: TakenOver[] = [];
  const pvWins = new Set<string>();
  const skipSend = new Set<string>();
  const pulledIds = new Set<string>();
  const assigneeWrites = new Map<string, { repo: string; number: number; logins: string[]; want: string[]; hash: string }>(); // item -> what to write to the issue
  const agreedAssignees = new Map<string, string>(); // item -> the assignees hash both sides will show
  for (const r of pre.received) {
    const asg = pre.compares.get(r.id)?.assignees;
    if (asg && r.assigneeSend && asg.writable) assigneeWrites.set(r.id, { repo: asg.repo, number: asg.number, logins: asg.cmp.writeLogins, want: asg.cmp.pvLogins, hash: asg.cmp.pvHash });
    const fields: Record<string, string> = {};
    for (const c of r.conflicts ?? []) {
      const pick = choices.find((x) => x.itemId === r.id && x.field === c.field)!;
      if (c.field === "assignees") {
        if (!asg) continue;
        if (pick.choice === "github") {
          const { error } = await ctx.adminUi.rpc("github_pull_assignees", { p_actor: ctx.actor, p_item: r.id, p_user_ids: asg.cmp.pullUserIds, p_base: null });
          if (error) { failed.set(r.id, "The assignees from GitHub could not be applied. Nothing was changed for this initiative."); console.error(JSON.stringify({ github: "pull-assignees", error: error.message.slice(0, 200) })); }
          else { pulledIds.add(r.id); agreedAssignees.set(r.id, asg.cmp.ghHash); }
        } else if (asg.writable) {
          assigneeWrites.set(r.id, { repo: asg.repo, number: asg.number, logins: asg.cmp.writeLogins, want: asg.cmp.pvLogins, hash: asg.cmp.pvHash });
        }
        continue;
      }
      const boardValue = pre.compares.get(r.id)?.board.find((b) => b.key === c.field);
      // Keep Product Velocity writes it to GitHub; an empty Product Velocity value has nothing to write (a board is never cleared)
      if (pick.choice === "pv") { if (!(c.where === "board" && c.pv === "(empty)")) pvWins.add(r.id); continue; }
      if (c.field === "block") { skipSend.add(r.id); continue; }
      if (c.where === "board") { if (boardValue?.pull) fields[boardValue.pull.column] = boardValue.pull.value; continue; }
      fields[SYNC_FIELD_COLUMN[c.field as SyncTextField]] = c.github;
    }
    if (Object.keys(fields).length === 0) continue;
    const { data, error } = await ctx.adminUi.rpc("github_apply_pull", { p_actor: ctx.actor, p_item: r.id, p_fields: fields, p_base: null });
    if (error) { failed.set(r.id, "The text from GitHub could not be applied. Nothing was changed for this initiative."); console.error(JSON.stringify({ github: "pull", error: error.message.slice(0, 200) })); continue; }
    pulledIds.add(r.id);
    const replaced = (data ?? {}) as Record<string, string | null>;
    for (const column of Object.keys(fields)) taken.push({ itemId: r.id, code: r.code, field: column as TakenOver["field"], before: replaced[column] ?? null, after: fields[column] ?? null });
  }
  for (const [id, message] of failed) results.push({ id, code: pre.received.find((r) => r.id === id)?.code ?? "", outcome: "error", message });

  const sendIds = ids.filter((id) => !failed.has(id) && !skipSend.has(id));
  const sent = sendIds.length === 0 ? [] : await executePush({ supabase: ctx.supabase, admin: ctx.adminUi, sc: ctx.sc, connection: ctx.connection, tenantId: ctx.tenantId, actor: ctx.actor, appUrl: ctx.appUrl, ids: sendIds, force: pvWins });
  for (const s of sent) results.push(s);
  // assignees: written to the issue after the send, once the person confirmed; GitHub silently skips people who are not collaborators, so what it really set is checked
  for (const [id, w] of assigneeWrites) {
    if (failed.has(id) || skipSend.has(id) || sent.some((x) => x.id === id && (x.outcome === "error" || x.outcome === "blocked" || x.outcome === "missing"))) continue;
    const code = pre.received.find((r) => r.id === id)?.code ?? "";
    try {
      const set = (await ctx.sc.setIssueAssignees(ctx.connection.installation_id!, w.repo, w.number, w.logins)).map((l) => l.toLowerCase());
      await ctx.adminGithub.rpc("github_apply_assignees", { p_connection: ctx.connection.id, p_item: id, p_logins: set });
      const missing = w.want.filter((l) => !set.includes(l));
      if (missing.length === 0) agreedAssignees.set(id, w.hash);
      results.push({ id, code, outcome: missing.length ? "error" : "updated", issueNumber: w.number, message: missing.length ? `GitHub did not assign ${missing.map((l) => `@${l}`).join(", ")}: they must be collaborators of ${w.repo}.` : "Assignees updated." });
    } catch (e) {
      console.error(JSON.stringify({ github: "set-assignees", error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
      results.push({ id, code, outcome: "error", issueNumber: w.number, message: "The assignees could not be written to GitHub. Try again." });
    }
  }
  for (const id of skipSend) results.push({ id, code: pre.received.find((r) => r.id === id)?.code ?? "", outcome: "unchanged", message: "The managed block was left as it is in GitHub." });

  // both sides now say the same: remember it, from the texts as they stand in Product Velocity after the pull
  const done = sent.filter((s) => s.outcome === "created" || s.outcome === "updated" || (s.outcome === "unchanged" && !pvWins.has(s.id))).map((s) => s.id);
  const settled = [...new Set([...done, ...[...pulledIds].filter((id) => skipSend.has(id) === false && !sent.some((s) => s.id === id && (s.outcome === "error" || s.outcome === "blocked" || s.outcome === "missing")))])];
  if (settled.length > 0) {
    const { data } = await ctx.supabase.from("items").select("id, item_code, initiative_name, summary, description, hypothesis").eq("tenant_id", ctx.tenantId).in("id", settled);
    for (const r of (data ?? []) as PvRow[]) {
      const t = pvText(r);
      // the board values that were compared: what both sides now show is Product Velocity's value, or the board's where PV had none or took it over
      const board = Object.fromEntries((pre.compares.get(r.id)?.board ?? []).map((b) => [b.key, choices.find((x) => x.itemId === r.id && x.field === b.key)?.choice === "github" || b.pvText === "" ? b.ghHash : b.pvHash]));
      const asgCmp = pre.compares.get(r.id)?.assignees;
      const assignees = agreedAssignees.get(r.id) ?? (asgCmp && asgCmp.cmp.verdict === "none" ? asgCmp.cmp.pvHash : undefined); // only what both sides now agree on is remembered
      await recordBase(ctx, r.id, { ...(Object.fromEntries(SYNC_TEXT_FIELDS.map((f) => [f, pvHash(f, t[f])])) as Record<SyncTextField, string>), ...board, ...(assignees ? { assignees } : {}) });
    }
  }
  return { ok: true, results, taken };
}
