import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BLOCK_END, BLOCK_START, compareBoardValues, compareIssue, hashText, isBoardConflict, parseBoard, type BoardFieldCompare, type BoardKey, SYNC_FIELD_COLUMN, SYNC_FIELD_LABEL, SYNC_FIELD_LIMIT, SYNC_TEXT_FIELDS, type IssueCompare, type SourceControl, type SyncTextField } from "@pv/github";
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
};
type PvRow = { id: string; item_code: string; initiative_name: string; summary: string | null; description: string | null; hypothesis: string | null; moscow: string | null; theme: string | null; end_date: string | null; effort: string | null; home_project_id: string | null };
type SyncBase = Partial<Record<SyncTextField | BoardKey, string>>;
type BaseRow = { item_id: string; mode: string; sync_base: SyncBase | null; project_item_id: string | null };

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
      if (issue) out.set(l.item_id, { title: issue.title ?? "", body: issue.body });
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
  const [items, links, projects, groups] = await Promise.all([
    ctx.supabase.from("items").select("id, item_code, initiative_name, summary, description, hypothesis, moscow, theme, end_date, effort, home_project_id").eq("tenant_id", ctx.tenantId).is("deleted_at", null).in("id", ids),
    ctx.supabase.from("item_github_links").select("item_id, mode, sync_base, project_item_id").eq("tenant_id", ctx.tenantId).eq("connection_id", ctx.connection.id).in("item_id", ids),
    ctx.supabase.from("projects").select("id, github_board").eq("tenant_id", ctx.tenantId).not("github_board", "is", null),
    ctx.supabase.from("item_groups").select("name").eq("tenant_id", ctx.tenantId),
  ]);
  // a read that fails must never look like "in step": without these reads nothing can be compared
  const failed = items.error ?? links.error ?? projects.error ?? groups.error;
  if (failed) {
    console.error(JSON.stringify({ github: "compare", error: failed.message.slice(0, 200) }));
    return { compares: new Map(), error: "The texts could not be compared with GitHub just now (the database refused the read). Nothing was sent. If this keeps happening, check that the latest database migration has been applied." };
  }
  const linkBy = new Map(((links.data ?? []) as BaseRow[]).map((l) => [l.item_id, l]));
  const boardOf = new Map(((projects.data ?? []) as { id: string; github_board: unknown }[]).map((p) => [p.id, parseBoard(p.github_board)]));
  const groupNames = ((groups.data ?? []) as { name: string }[]).map((g) => g.name);
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
    out.set(r.id, {
      code: r.item_code, cmp, blockHash: blockHashOf(issue.body), baseComplete: SYNC_TEXT_FIELDS.every((f) => link.sync_base?.[f] === pvHashes[f]), pvHashes,
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
    else if (c && (!c.baseComplete || !c.boardBaseComplete) && c.cmp.fields.every((f) => f.verdict === "none") && c.board.every((b) => b.verdict === "none")) await recordBase(ctx, r.id, { ...c.pvHashes, ...Object.fromEntries(c.board.map((b) => [b.key, b.pvHash])) });
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
      if (pick.choice === "github" && c.githubPullable === false) return { ok: false, error: `${c.label}: the value on the board cannot be taken over into Product Velocity, so only Keep Product Velocity is possible. Nothing was applied or sent.`, stale: strip(pre) };
    }
  }

  const failed = new Map<string, string>();
  const results: PushItemResult[] = [];
  const taken: TakenOver[] = [];
  const pvWins = new Set<string>();
  const skipSend = new Set<string>();
  const pulledIds = new Set<string>();
  for (const r of pre.received) {
    const fields: Record<string, string> = {};
    for (const c of r.conflicts ?? []) {
      const pick = choices.find((x) => x.itemId === r.id && x.field === c.field)!;
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
      await recordBase(ctx, r.id, { ...(Object.fromEntries(SYNC_TEXT_FIELDS.map((f) => [f, pvHash(f, t[f])])) as Record<SyncTextField, string>), ...board });
    }
  }
  return { ok: true, results, taken };
}
