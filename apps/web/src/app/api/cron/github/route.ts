import { githubSourceControl } from "@/lib/github/server";
import { reconcileConnection, retryEvent } from "@/lib/github/sync";
import type { ConnectionRow } from "@/lib/github/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daily safety net (Vercel Cron, free plan: once a day). Retries events that failed, then compares GitHub with every linked
 * item and repairs drift. Vercel sends `Authorization: Bearer <CRON_SECRET>`; anything else is refused.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("forbidden", { status: 403 });
  const sc = githubSourceControl();
  if (!sc) return new Response("not configured", { status: 503 });

  const admin = createAdminClient({ via: "GitHub webhook" });
  const { data: connections } = await admin.from("github_connections").select("*").eq("state", "connected");
  const report: { retried: number; checked: number; changed: number; missing: number; failed: number } = { retried: 0, checked: 0, changed: 0, missing: 0, failed: 0 };
  for (const c of (connections ?? []) as ConnectionRow[]) {
    try {
      const { data: failed } = await admin.from("sync_events").select("id").eq("tenant_id", c.tenant_id).eq("state", "error").lt("attempts", 5).limit(100);
      for (const e of (failed ?? []) as { id: string }[]) if (await retryEvent(admin, c.tenant_id, e.id)) report.retried++;
      const r = await reconcileConnection(admin, sc, c);
      report.checked += r.checked; report.changed += r.changed; report.missing += r.missing;
    } catch (e) {
      report.failed++;
      console.error(JSON.stringify({ github: "cron", connection: c.id, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
    }
  }
  return Response.json(report);
}
