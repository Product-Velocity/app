import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canLinkFilesInto, columnOnItems, FIELD_BY_KEY } from "@pv/domain";
import { createHash } from "node:crypto";
import { buildTrackingIssue, OUTBOUND_READ_FIELDS, childKey, childrenToAdd, describePushError, parseBoard, planAction, planBoardItem, pushBoardChildren, pushBoardItem, pushTrackingIssue, readIssueTree, type Board, type BoardField, type BoardPlan, type ExistingLink, type PlanLink, type SourceControl, type TrackingIssue } from "@pv/github";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ConnectionRow } from "./server";
import { syncBoardStatuses } from "./board-sync";
import { shareUrl } from "@/lib/files/serve";
import { refreshTree } from "./sync";
import { PUSH_LIMIT, type PlanItem, type PushItemResult } from "./push-types";

type Admin = ReturnType<typeof createAdminClient>;
type Link = { item_id: string; mode: "push" | "follow"; repo_full_name: string; issue_number: number | null; html_url: string | null; sync_state: string; last_pushed_hash: string | null };
type Row = { id: string; item_code: string; initiative_name: string; summary: string | null; description: string | null; hypothesis: string | null; moscow: string | null; stack_rank: number; change_type: string | null; g2m_date_est: string | null; theme: string | null; effort: string | null; home_project_id: string };

type SharedFile = { item_id: string; name: string; share_token: string | null };
const sharedFilesByItem = (rows: SharedFile[], appUrl: string) => {
  const m = new Map<string, { label: string; url: string }[]>();
  for (const r of rows) if (r.share_token) m.set(r.item_id, [...(m.get(r.item_id) ?? []), { label: r.name, url: shareUrl(appUrl, r.share_token, r.name) }]);
  return m;
};

/**
 * The `items` columns a push may read, taken from the field registry so a field stored under another column name
 * (G2M Date (est) lives in `end_date`) is asked for by its real column. A column that does not exist makes the whole read fail.
 */
export const ITEM_SELECT = ["id", ...OUTBOUND_READ_FIELDS.map((k) => (k === "item_code" ? k : columnOnItems(FIELD_BY_KEY[k]!)!)), "home_project_id"].join(", ");
/** A row as read with ITEM_SELECT, with every allowlisted value under its field key (what the payload builder reads). */
const asOutboundItem = (row: Record<string, unknown>): Row => {
  const out: Record<string, unknown> = { ...row };
  for (const k of OUTBOUND_READ_FIELDS) if (k !== "item_code") out[k] = row[columnOnItems(FIELD_BY_KEY[k]!)!];
  return out as Row;
};

const blockedItem = (id: string, reason: string, over: Partial<PlanItem> = {}): PlanItem => ({ id, code: "", name: "", project: "", repo: null, action: "blocked", title: "", labels: [], block: "", issueNumber: null, issueUrl: null, reason, ...over });

/** What the confirm step needs for one item, beyond what the person sees in the preview. */
type Internal = { built: TrackingIssue; existing: ExistingLink | null; board?: Board; boardPlan?: BoardPlan; /** Children known to the cache that are not on the board yet. */ pendingChildren: number };

/** At most this many children are put on the board per initiative and send, so one send stays quick; the rest follow at the next send. */
export const CHILD_LIMIT = 40;

/**
 * Works out what a push would do for each item, without writing anything. Only the allowlisted item columns are
 * selected (never `select *`), through the signed-in user's own client, so RLS applies. With `sc`, the fields of a linked
 * GitHub Project are read so the preview can show what would be written there.
 */
export async function planPush(supabase: SupabaseClient, tenantId: string, appUrl: string, connection: ConnectionRow, ids: string[], sc?: SourceControl): Promise<PlanItem[]> {
  return (await computePlan(supabase, tenantId, appUrl, connection, ids, sc)).items;
}

async function computePlan(supabase: SupabaseClient, tenantId: string, appUrl: string, connection: ConnectionRow, ids: string[], sc?: SourceControl): Promise<{ items: PlanItem[]; internal: Map<string, Internal> }> {
  const unique = [...new Set(ids)].slice(0, PUSH_LIMIT);
  const internal = new Map<string, Internal>();
  const [items, projects, repos, links, artifacts, sharedFiles, tree] = await Promise.all([
    supabase.from("items").select(ITEM_SELECT).eq("tenant_id", tenantId).is("deleted_at", null).in("id", unique),
    supabase.from("projects").select("id, name, default_repo, tracker, github_board").eq("tenant_id", tenantId),
    supabase.from("github_repositories").select("full_name, access, is_private").eq("tenant_id", tenantId).eq("connection_id", connection.id).is("removed_at", null),
    supabase.from("item_github_links").select("item_id, mode, repo_full_name, issue_number, html_url, sync_state, last_pushed_hash").eq("tenant_id", tenantId).in("item_id", unique),
    supabase.from("item_links").select("item_id, label, url").eq("tenant_id", tenantId).in("item_id", unique),
    supabase.from("item_files").select("item_id, name, share_token").eq("tenant_id", tenantId).in("item_id", unique).order("created_at"),
    supabase.from("item_issue_tree").select("item_id, repo_full_name, issue_number, board_id").eq("tenant_id", tenantId).in("item_id", unique),
  ]);
  const treeByItem = new Map<string, { board_id: string | null }[]>();
  for (const t of (tree.data ?? []) as { item_id: string; board_id: string | null }[]) treeByItem.set(t.item_id, [...(treeByItem.get(t.item_id) ?? []), t]);
  if (items.error) return { items: unique.map((id) => blockedItem(id, "The initiatives could not be read just now. Try again, and tell Ashu if it keeps happening.")), internal };
  const rowById = new Map(((items.data ?? []) as unknown as Record<string, unknown>[]).map(asOutboundItem).map((r) => [r.id, r]));
  type ProjectRow = { id: string; name: string; default_repo: string | null; tracker: string | null; github_board?: unknown };
  const projectById = new Map(((projects.data ?? []) as ProjectRow[]).map((p) => [p.id, p]));
  const repoRows = (repos.data ?? []) as { full_name: string; access: string; is_private: boolean | null }[];
  const privateRepos = new Set(repoRows.filter((r) => canLinkFilesInto(r.is_private)).map((r) => r.full_name.toLowerCase()));
  const activeRepos = new Set(repoRows.map((r) => r.full_name.toLowerCase()));
  const readOnlyRepos = new Set(repoRows.filter((r) => r.access === "read_only").map((r) => r.full_name.toLowerCase()));
  const linkByItem = new Map(((links.data ?? []) as Link[]).map((l) => [l.item_id, l]));
  const artifactsByItem = new Map<string, { label: string; url: string }[]>();
  for (const a of (artifacts.data ?? []) as { item_id: string; label: string; url: string }[]) artifactsByItem.set(a.item_id, [...(artifactsByItem.get(a.item_id) ?? []), { label: a.label, url: a.url }]);

  const fileRows = (sharedFiles.data ?? []) as SharedFile[];
  const filesByItem = sharedFilesByItem(fileRows, appUrl);
  const unsharedByItem = new Map<string, number>();
  for (const r of fileRows) if (!r.share_token) unsharedByItem.set(r.item_id, (unsharedByItem.get(r.item_id) ?? 0) + 1);

  // the fields of every linked board in this push, read once; null when the board cannot be read right now
  const boards = new Map<string, Board>();
  for (const id of unique) {
    const b = parseBoard(projectById.get(rowById.get(id)?.home_project_id ?? "")?.github_board);
    if (b) boards.set(b.id, b);
  }
  const boardFields = new Map<string, BoardField[] | null>();
  if (sc) {
    await Promise.all([...boards.keys()].map(async (boardId) => {
      boardFields.set(boardId, await sc.getBoardFields(connection.installation_id!, boardId).catch(() => null));
    }));
  }

  const planned = unique.map((id): PlanItem => {
    const row = rowById.get(id);
    if (!row) return blockedItem(id, "This initiative no longer exists or you cannot see it.");
    const project = projectById.get(row.home_project_id);
    const link = linkByItem.get(id);
    if (project?.tracker && project.tracker !== "github") return blockedItem(id, `${project.name} is linked to ${project.tracker === "jira" ? "Jira" : project.tracker}: a project has one tracker, so its initiatives are not sent to GitHub.`, { code: row.item_code, name: row.initiative_name, project: project.name });
    const planLink: PlanLink | null = link ? { mode: link.mode, repo: link.repo_full_name, issueNumber: link.issue_number, syncState: link.sync_state, lastPushedHash: link.last_pushed_hash } : null;
    const itemFiles = filesByItem.get(id) ?? [];
    const target = (link?.repo_full_name ?? project?.default_repo ?? "").toLowerCase();
    const filesOk = privateRepos.has(target);
    const built = buildTrackingIssue({ item: row, itemId: id, projectName: project?.name ?? "", appUrl, artifacts: artifactsByItem.get(id) ?? [], files: filesOk ? itemFiles : [] });

    // the linked GitHub Project: what would be written there is part of "changed", so changing a priority is a push
    const board = parseBoard(project?.github_board);
    const fields = board ? boardFields.get(board.id) : undefined;
    const boardPlan = board && fields && link?.mode !== "follow" ? planBoardItem({ moscow: row.moscow, theme: row.theme, end_date: row.g2m_date_est, effort: row.effort }, fields, board.mapping) : undefined;
    const boardNotes = board && sc && fields === null ? [`The board "${board.title}" could not be read just now, so it is left as it is.`] : [];
    if (boardPlan) built.hash = createHash("sha256").update(`${built.hash}|${boardPlan.signature}`).digest("hex");

    const d = planAction({ link: planLink, defaultRepo: project?.default_repo ?? null, activeRepos, readOnlyRepos, hash: built.hash, projectName: project?.name ?? "" });
    // children (epics and tasks, all levels) that engineers or an agent added in GitHub are put on the board by a confirmed send, never in the background
    const pendingChildren = board && boardPlan?.include ? (treeByItem.get(id) ?? []).filter((t) => t.board_id !== board.id).length : 0;
    if (d.action === "unchanged" && pendingChildren > 0) d.action = "update";
    internal.set(id, { built, existing: link ? { issueNumber: link.issue_number, lastPushedHash: link.last_pushed_hash } : null, pendingChildren, ...(board && boardPlan ? { board, boardPlan } : {}) });
    const withheld = itemFiles.length > 0 && !filesOk ? { filesNote: `${itemFiles.length === 1 ? "A shared file link was" : `${itemFiles.length} shared file links were`} left out: ${d.repo ?? "this repository"} is public (or its visibility is unknown), and anyone could open the links. Files are only linked in private repositories.` } : {};
    const unshared = unsharedByItem.get(id) ?? 0;
    const note = withheld.filesNote ?? (unshared ? `${unshared === 1 ? "1 attached file has" : `${unshared} attached files have`} no share link, so ${unshared === 1 ? "it is" : "they are"} not in the issue. Turn a link on in the item's Screenshots field to include it.` : undefined);
    const boardInfo = board && boardPlan ? { title: board.title, included: boardPlan.include, writes: boardPlan.writes.map((w) => ({ field: w.field.name, value: w.label })), notes: boardPlan.notes, children: pendingChildren } : board && boardNotes.length ? { title: board.title, included: false, writes: [], notes: boardNotes, children: 0 } : undefined;
    return { id, code: row.item_code, name: row.initiative_name, project: project?.name ?? "", repo: d.repo, action: d.action, title: built.title, labels: built.labels, ...(built.milestone ? { milestone: built.milestone.title } : {}), ...(boardInfo ? { board: boardInfo } : {}), block: built.block, issueNumber: link?.issue_number ?? null, issueUrl: link?.html_url ?? null, ...(d.reason ? { reason: d.reason } : {}), ...(note ? { filesNote: note } : {}) };
  });
  return { items: planned, internal };
}

/** Sends the confirmed plan. Per item: push, then the board, then record the link on behalf of the person who confirmed. One item failing never stops the others. */
export async function executePush(opts: { supabase: SupabaseClient; admin: Admin; sc: SourceControl; connection: ConnectionRow; tenantId: string; actor: string; appUrl: string; ids: string[] }): Promise<PushItemResult[]> {
  const { items: plan, internal } = await computePlan(opts.supabase, opts.tenantId, opts.appUrl, opts.connection, opts.ids, opts.sc);
  const installationId = opts.connection.installation_id!;

  const results: PushItemResult[] = [];
  for (const p of plan) {
    const code = p.code;
    if (p.action === "blocked") { results.push({ id: p.id, code, outcome: "blocked", message: p.reason }); continue; }
    if (p.action === "unchanged") { results.push({ id: p.id, code, outcome: "unchanged", issueNumber: p.issueNumber ?? undefined, issueUrl: p.issueUrl ?? undefined }); continue; }
    const { built, existing, board, boardPlan, pendingChildren } = internal.get(p.id)!;
    const onBoard = !!(board && boardPlan?.include);
    const record = (state: "synced" | "error", extra: { number?: number; id?: number; node?: string; url?: string; error?: string }) =>
      opts.admin.rpc("github_record_push", { p_actor: opts.actor, p_item: p.id, p_connection: opts.connection.id, p_repo: p.repo, p_number: extra.number ?? null, p_issue_id: extra.id ?? null, p_node_id: extra.node ?? null, p_url: extra.url ?? null, p_hash: built.hash, p_state: state, p_error: extra.error ?? null });
    try {
      const r = await pushTrackingIssue(opts.sc, installationId, p.repo!, p.id, built, existing);
      if (r.kind === "missing") {
        await record("error", { error: "The GitHub issue no longer exists. Unlink it or create a new one." });
        results.push({ id: p.id, code, outcome: "missing", message: "The linked GitHub issue no longer exists (deleted or moved). Nothing was recreated." });
      } else if (r.kind === "unchanged" && !(onBoard && pendingChildren > 0)) {
        results.push({ id: p.id, code, outcome: "unchanged" });
      } else {
        // an issue that needed no change can still have children that are not on the board yet
        const issue = r.kind === "unchanged" ? { number: existing!.issueNumber! } : { number: r.issue.number, id: r.issue.id, node: r.issue.nodeId, url: r.issue.htmlUrl };
        let boardItem: string | null = null;
        let children: { added: { repo: string; number: number; boardItemId: string }[]; later: number } | null = null;
        if (board && boardPlan?.include) {
          try {
            if (r.kind !== "unchanged") boardItem = await pushBoardItem(opts.sc, installationId, board.id, r.issue.nodeId, boardPlan);
            children = await addChildren(opts, p.id, p.repo!, issue.number, board.id);
          } catch (e) {
            // the issue is written but the board is not: not recorded as synced, so the next push does the board again
            const message = `The issue was written, but the board "${board.title}" could not be updated: ${describePushError(e)}`;
            await record("error", { ...issue, error: message });
            results.push({ id: p.id, code, outcome: "error", issueNumber: issue.number, ...(r.kind !== "unchanged" ? { issueUrl: r.issue.htmlUrl } : {}), message });
            continue;
          }
        }
        const saved = r.kind === "unchanged" ? { error: null } : await record("synced", issue);
        if (!saved.error && boardItem) await opts.admin.rpc("github_record_project_item", { p_actor: opts.actor, p_item: p.id, p_project_item_id: boardItem });
        if (!saved.error && r.kind !== "unchanged") await refreshTree(opts.admin, opts.sc, installationId, opts.connection.id, { item_id: p.id, repo: p.repo!, number: issue.number }); // starts the Traditional breakdown route
        if (!saved.error && board && children?.added.length) await opts.admin.rpc("github_record_board_items", { p_connection: opts.connection.id, p_item: p.id, p_board_id: board.id, p_nodes: children.added.map((c) => ({ repo: c.repo, number: c.number, board_item_id: c.boardItemId })) });
        const childNote = children ? [children.added.length ? `${children.added.length} child issue${children.added.length === 1 ? "" : "s"} added to the board.` : "", children.later ? `${children.later} more will be added at the next send.` : ""].filter(Boolean).join(" ") : "";
        const message = saved.error ? "Sent to GitHub, but the link could not be saved. Pushing again will find the issue." : childNote || undefined;
        results.push({ id: p.id, code, outcome: r.kind === "unchanged" ? "updated" : r.kind, issueNumber: issue.number, ...(r.kind !== "unchanged" ? { issueUrl: r.issue.htmlUrl } : {}), ...(message ? { message } : {}) });
      }
    } catch (e) {
      const message = describePushError(e);
      await record("error", { error: message });
      results.push({ id: p.id, code, outcome: "error", message });
    }
  }
  // the boards this send touched: read their Status now, so Delivery Status is right as soon as the send is done (a failed read changes nothing)
  const touched = [...new Set([...internal.values()].filter((x) => x.board && x.boardPlan?.include).map((x) => x.board!.id))];
  if (touched.length > 0 && results.some((r) => r.outcome === "created" || r.outcome === "updated")) {
    await syncBoardStatuses(opts.admin, opts.sc, opts.connection, { boardIds: touched }).catch((e) => console.error(JSON.stringify({ github: "board-status", error: describePushError(e) })));
  }
  return results;
}

/** Reads the initiative's children from GitHub now (all levels) and puts those that are not on the board yet on it. Returns who was added (the caller records it) and how many wait. */
async function addChildren(opts: { admin: Admin; sc: SourceControl; connection: ConnectionRow }, itemId: string, repo: string, number: number, boardId: string) {
  const tree = (await readIssueTree(opts.sc, opts.connection.installation_id!, repo, number)) ?? [];
  const { data } = await opts.admin.from("item_issue_tree").select("repo_full_name, issue_number").eq("item_id", itemId).eq("board_id", boardId);
  const known = new Set(((data ?? []) as { repo_full_name: string; issue_number: number }[]).map((r) => childKey(r.repo_full_name, r.issue_number)));
  const { add, later } = childrenToAdd(tree.map((n) => ({ repo: n.repo, number: n.number, nodeId: n.nodeId })), known, CHILD_LIMIT);
  return { added: await pushBoardChildren(opts.sc, opts.connection.installation_id!, boardId, add), later };
}
