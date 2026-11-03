"use server";

import { removedGate, UUID } from "@/lib/tracker/removed-gate";
import type { RemovedList, RemovedResult } from "@/lib/github/push-types";
import { closeOne, listRemoved } from "@/lib/atlassian/jira-removed-engine";

// "Removed in Product Velocity" in Sync with Jira (decision 2026-11-03-jira-close-removed). listRemovedInJira reads (writes nothing);
// closeRemovedInJira labels and closes ONE initiative's issue after the person confirmed it in the dialog. Only creators and admins reach it:
// Claude (MCP) has no tool for it, service accounts are refused here and again by the database function, platform staff are refused here.

const TRANSITION = /^[0-9]{1,10}$/;

const gate = () => removedGate("Jira");

export async function listRemovedInJira(): Promise<RemovedList> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  return listRemoved(g.ctx);
}

export async function closeRemovedInJira(id: string, transitionId: string | null): Promise<{ ok: true; result: RemovedResult } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Choose an initiative." };
  if (transitionId !== null && (typeof transitionId !== "string" || !TRANSITION.test(transitionId))) return { ok: false, error: "That is not a Jira transition." };
  return { ok: true, ...(await closeOne(g.ctx, id, transitionId)) };
}
