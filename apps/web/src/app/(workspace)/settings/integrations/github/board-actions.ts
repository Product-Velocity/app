"use server";

import { revalidatePath } from "next/cache";
import { detectMapping, parseBoard, type BoardField, type BoardInfo, type BoardMapping, type FieldRef } from "@pv/github";
import { githubSourceControl, type ConnectionRow } from "@/lib/github/server";
import { requireWorkspace } from "@/lib/session";

const PATH = "/settings/integrations/github";
export type BoardChoice = { id: string; number: number; title: string; url: string };
export type BoardFieldChoice = { id: string; name: string; dataType: BoardField["dataType"] };
export type BoardState = { ok: true; fields: BoardFieldChoice[]; mapping: BoardMapping } | { ok: false; error: string };
export type SaveState = { error?: string; ok?: string } | null;

const SLOTS = {
  priority: ["SINGLE_SELECT"], group: ["SINGLE_SELECT", "TEXT"], dueDate: ["DATE"], size: ["SINGLE_SELECT"], status: ["SINGLE_SELECT"],
} as const satisfies Record<string, BoardField["dataType"][]>;

/** Admins only (a person, not a service account), with the workspace's connected GitHub installation. */
async function gate() {
  const ctx = await requireWorkspace(PATH);
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (ctx.active.role !== "admin" || me?.is_service_account) return { ok: false, error: "Only admins can change this." } as const;
  const sc = githubSourceControl();
  if (!sc) return { ok: false, error: "The GitHub App is not set up for this deployment yet." } as const;
  const { data } = await ctx.supabase.from("github_connections").select("*").eq("tenant_id", ctx.active.tenantId).eq("state", "connected").maybeSingle();
  const connection = data as ConnectionRow | null;
  const installationId = connection?.installation_id;
  const org = connection?.account_login;
  if (!installationId || !org) return { ok: false, error: "This workspace is not connected to GitHub." } as const;
  return { ok: true, ctx, sc, installationId, org } as const;
}

const friendly = (e: unknown) =>
  e && typeof e === "object" && "status" in e && (e as { status: number }).status === 403
    ? "The GitHub App may not use Projects yet. In the App's settings add the Organization permission “Projects: read and write”, then accept the change on the installation page."
    : "GitHub could not be asked just now. Try again.";

/** The organisation's open Projects, to choose from. Writes nothing. */
export async function listBoardChoices(): Promise<{ boards: BoardChoice[] } | { error: string }> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  try {
    const boards: BoardInfo[] = await g.sc.listBoards(g.installationId, g.org);
    const open = boards.filter((b) => !b.closed).map(({ id, number, title, url }) => ({ id, number, title, url }));
    return open.length ? { boards: open } : { error: `No open Projects were found in ${g.org}. Create one in GitHub first (only organisation Projects can be linked, not personal ones).` };
  } catch (e) {
    return { error: friendly(e) };
  }
}

/** The fields of one Project and which of them PV would use by default. Writes nothing. */
export async function loadBoardFields(boardId: string): Promise<BoardState> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  try {
    const known = (await g.sc.listBoards(g.installationId, g.org)).some((b) => b.id === boardId && !b.closed);
    const fields = known ? await g.sc.getBoardFields(g.installationId, boardId) : null;
    if (!fields) return { ok: false, error: "That Project was not found in this organisation." };
    return { ok: true, fields: fields.map(({ id, name, dataType }) => ({ id, name, dataType })), mapping: detectMapping(fields) };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

/** Links a Project to a PV project with the chosen field mapping. Everything is checked against GitHub again here. */
export async function saveBoardLink(projectId: string, boardId: string, chosen: Record<string, string>): Promise<SaveState> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  if (typeof projectId !== "string" || typeof boardId !== "string" || !chosen || typeof chosen !== "object") return { error: "Choose a Project." };
  try {
    const board = (await g.sc.listBoards(g.installationId, g.org)).find((b) => b.id === boardId && !b.closed);
    const fields = board ? await g.sc.getBoardFields(g.installationId, boardId) : null;
    if (!board || !fields) return { error: "That Project was not found in this organisation." };
    const mapping = detectMapping([]);
    for (const [slot, types] of Object.entries(SLOTS)) {
      const id = chosen[slot];
      if (!id) { (mapping as unknown as Record<string, FieldRef | null>)[slot] = null; continue; }
      const f = fields.find((x) => x.id === id);
      if (!f || !(types as readonly string[]).includes(f.dataType)) return { error: `The field chosen for ${slot} is not usable there.` };
      (mapping as unknown as Record<string, FieldRef | null>)[slot] = { id: f.id, name: f.name };
    }
    const stored = parseBoard({ id: board.id, number: board.number, title: board.title, url: board.url, mapping });
    if (!stored) return { error: "That Project could not be linked." };
    const { error } = await g.ctx.supabase.from("projects").update({ github_board: stored }).eq("id", projectId).eq("tenant_id", g.ctx.active.tenantId);
    if (error) return { error: "We could not save that." };
  } catch (e) {
    return { error: friendly(e) };
  }
  revalidatePath(PATH);
  return { ok: "Linked" };
}

export async function unlinkBoard(projectId: string): Promise<SaveState> {
  const g = await gate();
  if (!g.ok) return { error: g.error };
  const { error } = await g.ctx.supabase.from("projects").update({ github_board: null }).eq("id", String(projectId)).eq("tenant_id", g.ctx.active.tenantId);
  if (error) return { error: "We could not save that." };
  revalidatePath(PATH);
  return { ok: "Unlinked" };
}
