import "server-only";
import type { SourceControl } from "@pv/github";
import type { createAdminClient } from "@/lib/supabase/admin";
import { recordIncoming } from "./sync";
import type { ConnectionRow } from "./server";

type Admin = ReturnType<typeof createAdminClient>;

/** Pages of 100 read per repository: the issues that changed lately are the first ones, newest first. */
const PAGES = 3;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * How far back the light check reads: an hour before the last full check (so nothing in flight is missed), a week back when there has not been
 * one, never more than 30 days, never the future. Webhooks keep the list current; this only covers what they missed.
 */
export function sinceFor(lastCheckAt: string | null | undefined, now: number): string {
  const last = lastCheckAt ? Date.parse(lastCheckAt) : NaN;
  const from = Number.isNaN(last) ? now - 7 * DAY : last - HOUR;
  return new Date(Math.min(now, Math.max(now - 30 * DAY, from))).toISOString();
}

/**
 * Reads, for every repository of the connection, only the issues that changed since `since` (one request when nothing did) and keeps their
 * light record for the Incoming list. Nothing is written to GitHub. One repository failing never stops the others.
 */
export async function refreshIncoming(admin: Admin, sc: SourceControl, connection: ConnectionRow, since: string): Promise<{ repos: number; read: number; failed: number }> {
  const result = { repos: 0, read: 0, failed: 0 };
  if (connection.installation_id === null) return result;
  const { data } = await admin.from("github_repositories").select("full_name").eq("connection_id", connection.id).is("removed_at", null);
  const repos = ((data ?? []) as { full_name: string }[]).map((r) => r.full_name);
  result.repos = repos.length;
  for (let i = 0; i < repos.length; i += 4) {
    await Promise.all(repos.slice(i, i + 4).map(async (repo) => {
      try {
        const issues = await sc.listIssues(connection.installation_id!, repo, { since, maxPages: PAGES });
        if (issues.length > 0) await recordIncoming(admin, connection.id, repo, issues);
        result.read += issues.length;
      } catch (e) {
        result.failed++;
        console.error(JSON.stringify({ github: "incoming-refresh", error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
      }
    }));
  }
  return result;
}
