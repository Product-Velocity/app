"use server";

import { removedGate, UUID } from "@/lib/tracker/removed-gate";
import type { RemovedList, RemovedResult } from "@/lib/github/push-types";
import { closeOne, listRemoved } from "@/lib/github/github-removed-engine";

// "Removed in Product Velocity" in Sync with GitHub (decision 2026-11-03-github-close-removed). listRemovedInGithub reads (writes nothing);
// closeRemovedInGithub labels and closes ONE initiative's issue after the person confirmed it in the dialog. Only creators and admins reach it:
// Claude (MCP) has no tool for it, service accounts are refused here and again by the database function, platform staff are refused here.

const gate = () => removedGate("GitHub");

export async function listRemovedInGithub(): Promise<RemovedList> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  return listRemoved(g.ctx);
}

/** `transitionId` exists only because the dialog's shape is shared with Jira: GitHub has no statuses to choose from (the issue is closed as "not planned"), so anything but null is refused. */
export async function closeRemovedInGithub(id: string, transitionId: string | null): Promise<{ ok: true; result: RemovedResult } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Choose an initiative." };
  if (transitionId !== null) return { ok: false, error: "GitHub has no status to choose: the issue is closed as not planned." };
  return { ok: true, ...(await closeOne(g.ctx, id)) };
}
