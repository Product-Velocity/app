import "server-only";
import type { DeliveryEvent, SourceControl } from "@pv/github";
import type { createAdminClient } from "@/lib/supabase/admin";
import { newExtrasCache, refreshExtras } from "./extras";

type Admin = ReturnType<typeof createAdminClient>;

/** At most this many initiatives are refreshed for one delivery, so a busy repository cannot turn one event into hundreds of reads. */
const MAX_ITEMS = 25;

const PR_ACTIONS = new Set(["opened", "closed", "reopened", "edited", "ready_for_review", "converted_to_draft"]);
const RELEASE_ACTIONS = new Set(["published", "released", "unpublished", "deleted", "edited"]);

/**
 * `pull_request`, `check_suite` and `release` deliveries: the initiatives they touch have their pull requests, checks and release read
 * again (read-only towards GitHub). A pull request is matched to initiatives through the issues it closes; a finished check suite on
 * the default branch and a release touch the initiatives whose primary repository, or one of whose issues, lives in that repository.
 * Only the repository, the pull request number and the branch of the delivery are used. Nothing is stored as a sync event.
 */
export async function ingestDeliveryEvent(admin: Admin, sc: SourceControl, ev: DeliveryEvent): Promise<"processed" | "ignored"> {
  const { data: conn } = await admin.from("github_connections").select("id, tenant_id").eq("installation_id", ev.installationId).eq("state", "connected").maybeSingle();
  if (!conn) return "ignored";

  let itemIds: string[] = [];
  if (ev.kind === "pull_request") {
    if (!PR_ACTIONS.has(ev.action)) return "ignored";
    const closing = await sc.getClosingIssues(ev.installationId, ev.repo, ev.number);
    itemIds = await itemsOfIssues(admin, conn.id, conn.tenant_id, closing);
  } else if (ev.kind === "check_suite") {
    if (ev.action !== "completed" || ev.headBranch !== ev.defaultBranch) return "ignored"; // only the default branch counts for CI
    itemIds = await itemsInRepo(admin, conn.id, conn.tenant_id, ev.repo, "primary");
  } else {
    if (!RELEASE_ACTIONS.has(ev.action)) return "ignored";
    itemIds = await itemsInRepo(admin, conn.id, conn.tenant_id, ev.repo, "any");
  }
  if (itemIds.length === 0) return "ignored";
  const cache = newExtrasCache();
  for (const id of itemIds.slice(0, MAX_ITEMS)) await refreshExtras(admin, sc, ev.installationId, conn.id, id, cache);
  return "processed";
}

async function itemsOfIssues(admin: Admin, connectionId: string, tenantId: string, issues: { repo: string; number: number }[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const i of issues.slice(0, 40)) {
    const [{ data: links }, { data: nodes }] = await Promise.all([
      admin.from("item_github_links").select("item_id").eq("connection_id", connectionId).ilike("repo_full_name", i.repo).eq("issue_number", i.number),
      admin.from("item_issue_tree").select("item_id").eq("tenant_id", tenantId).ilike("repo_full_name", i.repo).eq("issue_number", i.number),
    ]);
    for (const r of [...(links ?? []), ...(nodes ?? [])] as { item_id: string }[]) ids.add(r.item_id);
  }
  return [...ids];
}

async function itemsInRepo(admin: Admin, connectionId: string, tenantId: string, repo: string, scope: "primary" | "any"): Promise<string[]> {
  const { data: links } = await admin.from("item_github_links").select("item_id").eq("connection_id", connectionId).ilike("repo_full_name", repo).not("issue_number", "is", null).limit(MAX_ITEMS + 1);
  const ids = new Set(((links ?? []) as { item_id: string }[]).map((l) => l.item_id));
  if (scope === "any") {
    const { data: nodes } = await admin.from("item_issue_tree").select("item_id").eq("tenant_id", tenantId).ilike("repo_full_name", repo).limit(MAX_ITEMS + 1);
    for (const n of (nodes ?? []) as { item_id: string }[]) ids.add(n.item_id);
  }
  return [...ids];
}
