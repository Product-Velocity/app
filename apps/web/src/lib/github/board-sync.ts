import "server-only";
import { detectMapping, parseBoard, planStatusApply, readBoardStatuses, type SourceControl, type StatusLink } from "@pv/github";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ConnectionRow } from "./server";

type Admin = ReturnType<typeof createAdminClient>;
const PAGE = 1000;

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * Reads the Status of every linked board and applies it as Delivery Status. Read-only towards GitHub; towards the database it writes
 * only initiatives whose status or board item changed (the function it calls writes nothing for an unchanged value). `boardIds`
 * limits the pass to boards named by a webhook or by a send. A board that cannot be read is skipped, never failing the rest.
 */
export async function syncBoardStatuses(admin: Admin, sc: SourceControl, connection: ConnectionRow, opts: { boardIds?: string[] } = {}): Promise<{ boards: number; updated: number; notes: string[] }> {
  const installationId = connection.installation_id;
  if (!installationId) return { boards: 0, updated: 0, notes: [] };
  const { data: projects } = await admin.from("projects").select("id, github_board").eq("tenant_id", connection.tenant_id).not("github_board", "is", null);
  let boards = 0, updated = 0;
  const notes: string[] = []; // what a person should know: a board that was skipped, and why
  for (const p of (projects ?? []) as { id: string; github_board: unknown }[]) {
    const board = parseBoard(p.github_board);
    if (!board || (opts.boardIds && !opts.boardIds.includes(board.id))) continue;
    // a link saved before Delivery Status existed has no Status field chosen: find the board's own Status by name (it is only read, never written)
    const field = board.mapping.status ?? detectMapping((await sc.getBoardFields(installationId, board.id).catch(() => null)) ?? []).status;
    if (!field) { notes.push(`Board "${board.title}": no Status field found, so Delivery Status is not read.`); continue; }
    const onBoard = await readBoardStatuses(sc, installationId, board.id, field.name);
    if (onBoard.length === 0) { notes.push(`Board "${board.title}": no issues were read from it.`); continue; }
    boards++;
    const current = new Map((await all<{ id: string; gh_project_status: string | null }>((a, b) => admin.from("items").select("id, gh_project_status").eq("tenant_id", connection.tenant_id).eq("home_project_id", p.id).is("deleted_at", null).order("id").range(a, b))).map((i) => [i.id, i.gh_project_status]));
    const links: StatusLink[] = (await all<{ item_id: string; repo_full_name: string; issue_number: number | null; project_item_id: string | null }>((a, b) => admin.from("item_github_links").select("item_id, repo_full_name, issue_number, project_item_id").eq("connection_id", connection.id).not("issue_number", "is", null).order("item_id").range(a, b)))
      .filter((l) => current.has(l.item_id) && l.issue_number !== null)
      .map((l) => ({ item_id: l.item_id, repo: l.repo_full_name, number: l.issue_number!, projectItemId: l.project_item_id, current: current.get(l.item_id) ?? null }));
    const rows = planStatusApply(onBoard, links);
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await admin.rpc("github_apply_board_status", { p_connection: connection.id, p_rows: rows.slice(i, i + 200) });
      if (error) throw new Error(error.message);
      updated += Number(data ?? 0);
    }
  }
  return { boards, updated, notes };
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * A `projects_v2_item` delivery: an item of a board changed. Only a change of the board's mapped Status field (or an item added or
 * restored) is worth a read; GitHub does not send the new value, so the board is read again. Nothing is stored as a sync event.
 */
export async function ingestProjectItemEvent(admin: Admin, sc: SourceControl, ev: { installationId: number; action: string; boardId: string; fieldName: string | null }): Promise<"processed" | "ignored"> {
  if (!["edited", "created", "restored"].includes(ev.action)) return "ignored";
  const { data: conn } = await admin.from("github_connections").select("id, tenant_id, expected_account, installation_id, account_login, state").eq("installation_id", ev.installationId).eq("state", "connected").maybeSingle();
  if (!conn) return "ignored";
  const { data: projects } = await admin.from("projects").select("github_board").eq("tenant_id", (conn as ConnectionRow).tenant_id).not("github_board", "is", null);
  const board = ((projects ?? []) as { github_board: unknown }[]).map((p) => parseBoard(p.github_board)).find((b) => b?.id === ev.boardId);
  const status = board?.mapping.status;
  if (!board || !status) return "ignored";
  if (ev.action === "edited" && ev.fieldName && norm(ev.fieldName) !== norm(status.name)) return "ignored"; // another field changed
  const r = await syncBoardStatuses(admin, sc, conn as ConnectionRow, { boardIds: [ev.boardId] });
  return r.boards > 0 ? "processed" : "ignored";
}
