import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyLinkedStatuses } from "./refresh-jira";
import type { LinkToRead } from "./read-jira";
import { describeLines } from "./jira-events";
import { callbackUrl, eventIssueKey, hashSecret, newSecret, parseToken, planWebhooks, refreshWebhooks, registerWebhook, secretMatches, type WebhookRow } from "./jira-webhooks";
import { jiraRequest } from "./server";
import { ReconnectNeeded } from "./token-provider";

// Server side of the Jira webhooks (spike J3): switched ON by JIRA_WEBHOOKS=1 and JIRA_WEBHOOK_ORIGIN (the public https address of this
// deployment) only after Ashu has run the J3 spike on the sandbox site. Off, nothing is registered and the receiver answers 404.
export const webhooksEnabled = () => process.env.JIRA_WEBHOOKS === "1" && /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/.test(process.env.JIRA_WEBHOOK_ORIGIN ?? "");

type LinkRow = LinkToRead;

/** Daily: registers a webhook for each linked project that has none, extends the ones close to expiry. Returns counts. Never throws for one link. */
export async function maintainWebhooks(blocked: Set<string>): Promise<{ registered: number; refreshed: number; needsScope: number; failed: number }> {
  const out = { registered: 0, refreshed: 0, needsScope: 0, failed: 0 };
  if (!webhooksEnabled()) return out;
  const origin = process.env.JIRA_WEBHOOK_ORIGIN!;
  const admin = createAdminClient({ via: "system" });
  const { data: conns } = await admin.from("jira_connections").select("id, scopes").eq("state", "connected");
  const granted = new Map(((conns ?? []) as { id: string; scopes: string }[]).filter((c) => c.scopes.split(" ").includes("manage:jira-webhook")).map((c) => [c.id, true]));
  const { data: links } = await admin.from("jira_project_links").select("id, tenant_id, connection_id, site_id, jira_project_key").in("connection_id", [...granted.keys()]);
  const { data: rows } = await admin.from("jira_webhooks").select("link_id, jira_webhook_id, state, expires_at");
  const plan = planWebhooks(((links ?? []) as LinkRow[]).map((l) => ({ id: l.id, jira_project_key: l.jira_project_key })), (rows ?? []) as WebhookRow[], Date.now());
  const byId = new Map(((links ?? []) as LinkRow[]).map((l) => [l.id, l]));
  for (const a of plan) {
    const l = byId.get(a.link)!;
    if (a.do === "skip" || blocked.has(l.connection_id)) continue;
    const call = jiraRequest(l.connection_id, l.site_id);
    try {
      const existing = ((rows ?? []) as WebhookRow[]).find((r) => r.link_id === l.id);
      if (a.do === "refresh" && existing?.jira_webhook_id) {
        const r = await refreshWebhooks(call, [existing.jira_webhook_id]);
        if (r.expiresAt) { await admin.from("jira_webhooks").update({ expires_at: r.expiresAt, state: "active", last_error: null, updated_at: new Date().toISOString() }).eq("link_id", l.id); out.refreshed++; continue; }
        if (!r.unknown) { out.failed++; continue; } // a passing problem: the next daily run tries again, the webhook is still valid for days
      }
      const secret = newSecret();
      const reg = await registerWebhook(call, callbackUrl(origin, l.id, secret), l.jira_project_key);
      const base = { link_id: l.id, tenant_id: l.tenant_id, connection_id: l.connection_id, site_id: l.site_id, secret_hash: hashSecret(secret), updated_at: new Date().toISOString() };
      if (reg.ok) {
        // Jira reports the expiry in the list, not in the registration answer: 30 days is the documented value until the spike shows otherwise
        await admin.from("jira_webhooks").upsert({ ...base, jira_webhook_id: reg.id, state: "active", expires_at: new Date(Date.now() + 29 * 86_400_000).toISOString(), last_error: null }, { onConflict: "link_id" });
        out.registered++;
      } else {
        await admin.from("jira_webhooks").upsert({ ...base, jira_webhook_id: null, state: reg.kind === "needs_scope" ? "needs_scope" : "failed", last_error: reg.message }, { onConflict: "link_id" });
        if (reg.kind === "needs_scope") out.needsScope++; else out.failed++;
      }
    } catch (e) {
      if (e instanceof ReconnectNeeded) blocked.add(l.connection_id);
      out.failed++;
    }
  }
  return out;
}

/** One delivery. 404 = unknown or wrong secret (also when the feature is off); 200 = handled or ignorable; 500 = Jira may deliver again. */
export async function handleDelivery(token: string, body: unknown): Promise<number> {
  if (!webhooksEnabled()) return 404;
  const t = parseToken(token);
  if (!t) return 404;
  const admin = createAdminClient({ via: "system" });
  const { data: row } = await admin.from("jira_webhooks").select("link_id, secret_hash, events_received").eq("link_id", t.linkId).maybeSingle();
  if (!row || !secretMatches(row.secret_hash as string, t.secret)) return 404;
  const key = eventIssueKey(body);
  if (!key) return 200; // another event or a body without a usable key: nothing to do, nothing to retry
  const { data: link } = await admin.from("jira_project_links").select("id, tenant_id, connection_id, site_id, jira_project_key").eq("id", t.linkId).maybeSingle();
  if (!link || !key.startsWith(`${(link as LinkRow).jira_project_key}-`)) return 200;
  await admin.from("jira_webhooks").update({ last_event_at: new Date().toISOString(), events_received: ((row.events_received as number) ?? 0) + 1 }).eq("link_id", t.linkId);
  const { data: conn } = await admin.from("jira_connections").select("sites").eq("id", (link as LinkRow).connection_id).maybeSingle();
  const site = ((conn?.sites ?? []) as { id: string; url: string }[]).find((s) => s.id === (link as LinkRow).site_id);
  if (!site) return 200;
  try {
    // only an initiative linked to THIS issue is touched; the daily check still reads the tree and everything else
    const admin2 = createAdminClient({ via: "system" });
    const { data: linked } = await admin2.from("item_jira_links").select("item_id").eq("tenant_id", (link as LinkRow).tenant_id).eq("connection_id", (link as LinkRow).connection_id).eq("site_id", (link as LinkRow).site_id).eq("issue_key", key).is("frozen_at", null);
    const ids = ((linked ?? []) as { item_id: string }[]).map((x) => x.item_id);
    if (ids.length === 0) return 200;
    const done = await applyLinkedStatuses(link as LinkRow, site.url, { itemIds: ids });
    const l = link as LinkRow;
    // the recent-events table of the settings page: only deliveries that changed something (the rest would drown it)
    if (done.changedIssues.length > 0) await admin2.from("jira_sync_events").insert(done.changedIssues.map((c) => ({ tenant_id: l.tenant_id, link_id: l.id, source: "webhook", kind: "change", issue_key: c.key, summary: describeLines(c.lines), state: "processed" })));
    return 200;
  } catch (e) {
    const l = link as LinkRow;
    const reconnect = e instanceof ReconnectNeeded;
    await createAdminClient({ via: "system" }).from("jira_sync_events").insert({ tenant_id: l.tenant_id, link_id: l.id, source: "webhook", kind: "change", issue_key: key, summary: `Could not apply ${key}`, state: "error", last_error: reconnect ? "Sign in to Jira again" : e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    if (reconnect) return 200; // a new sign-in is needed; retrying cannot help, the settings page says so
    return 500;
  }
}
