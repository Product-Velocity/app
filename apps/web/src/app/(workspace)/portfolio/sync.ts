"use server";

import { requireWorkspace } from "@/lib/session";
import type { SyncChoice, SyncConfirmResult, SyncPreviewResult } from "@/lib/github/push-types";
import { routeSync, type BoardResult, type TrackerId, type TrackerOf } from "@/lib/tracker/sync-router";
import { checkGithubBoard, confirmGithubSync, startGithubSync } from "./github-push";

// The one entry point of the Sync dialog. It routes each initiative to the sync engine of its project's tracker (see lib/tracker/sync-router).
// GitHub's engine is unchanged; Jira's is registered here when it exists.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tracker of each initiative's project, read as the signed-in person (tenant-scoped by row-level security). */
const trackerOf: TrackerOf = async (ids) => {
  const out = new Map<string, TrackerId | null>();
  if (!ids.every((i) => typeof i === "string" && UUID.test(i))) return out;
  const ctx = await requireWorkspace("/portfolio");
  const { data: items } = await ctx.supabase.from("items").select("id, home_project_id").eq("tenant_id", ctx.active.tenantId).in("id", ids);
  const projectIds = [...new Set(((items ?? []) as { home_project_id: string | null }[]).map((i) => i.home_project_id).filter((p): p is string => !!p))];
  const { data: projects } = projectIds.length ? await ctx.supabase.from("projects").select("id, tracker").eq("tenant_id", ctx.active.tenantId).in("id", projectIds) : { data: [] };
  const tracker = new Map(((projects ?? []) as { id: string; tracker: TrackerId | null }[]).map((p) => [p.id, p.tracker]));
  for (const i of (items ?? []) as { id: string; home_project_id: string | null }[]) out.set(i.id, tracker.get(i.home_project_id ?? "") ?? null);
  return out;
};

const router = () => routeSync({ github: { start: startGithubSync, board: checkGithubBoard, confirm: confirmGithubSync } }, trackerOf);

export async function startSync(ids: string[], opts?: { board?: boolean }): Promise<SyncPreviewResult> { return router().start(ids, opts); }
export async function checkBoard(ids: string[]): Promise<BoardResult> { return router().board(ids); }
export async function confirmSync(ids: string[], choices: SyncChoice[]): Promise<SyncConfirmResult> { return router().confirm(ids, choices); }
