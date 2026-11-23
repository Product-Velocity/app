import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigured } from "@/lib/email/resend";
import { sendLogged } from "@/lib/email/send";
import { loadEmailOverride } from "@/lib/email/override";
import { buildFollowupPersonalEmail, buildWelcomePersonalEmail } from "@/lib/email/access";
import { SUPPORT_CONTACT } from "@/lib/public-contact";
import { siteUrl } from "@/lib/site-url";
import { firstNameOf, isFollowupCandidate, FOLLOWUP_AFTER_DAYS, FOLLOWUP_WINDOW_DAYS, FOLLOWUP_PER_RUN } from "@/lib/founder-rules";

/**
 * Personal emails from Ashu to the person who created a workspace: a welcome when setup is finished and one follow-up two days
 * after creation if the workspace is still empty. Both are off until FOUNDER_EMAILS=on is set on the deployment, so the wording can be
 * confirmed first. Replies go to the contact address. Each goes at most once per workspace (the send log is the memory), and a failure
 * never blocks the person or the daily check.
 */
export const founderEmailsOn = () => process.env.FOUNDER_EMAILS === "on" && emailConfigured();
const FROM_NAME = "Ashu from Product Velocity";

export async function sendWelcome(input: { tenantId: string; workspace: string; email: string | null | undefined; fullName: unknown }): Promise<void> {
  try {
    if (!founderEmailsOn() || !input.email) return;
    const admin = createAdminClient({ via: "system" });
    if (await alreadySent(admin, "app.welcome-personal", [input.tenantId]).then((s) => s.has(input.tenantId))) return;
    const mail = buildWelcomePersonalEmail({ name: firstNameOf(input.fullName), workspace: input.workspace, siteUrl: await siteUrl(), override: await loadEmailOverride("app.welcome-personal") });
    await sendLogged("app.welcome-personal", { to: input.email, replyTo: SUPPORT_CONTACT.email, fromName: FROM_NAME, ...mail }, { tenantId: input.tenantId });
  } catch {
    console.error(JSON.stringify({ founderEmail: "welcome-failed" }));
  }
}

async function alreadySent(admin: ReturnType<typeof createAdminClient>, key: string, tenantIds: string[]): Promise<Set<string>> {
  if (tenantIds.length === 0) return new Set();
  const { data } = await admin.from("email_send_log").select("tenant_id").eq("template_key", key).eq("is_test", false).eq("status", "sent").in("tenant_id", tenantIds);
  return new Set(((data ?? []) as { tenant_id: string }[]).map((r) => r.tenant_id));
}

const count = async (admin: ReturnType<typeof createAdminClient>, table: string, tenantId: string, extra?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  let q = admin.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  if (extra) q = extra(q);
  const { count: n } = await q;
  return n ?? 0;
};

/** Run once a day. Returns small numbers only (no addresses, no names). */
export async function sendFollowups(now = Date.now()): Promise<{ considered: number; sent: number }> {
  const out = { considered: 0, sent: 0 };
  try {
    if (!founderEmailsOn()) return out;
    const admin = createAdminClient({ via: "system" });
    const day = 86_400_000;
    const { data } = await admin.from("tenants").select("id, name, created_at, created_by")
      .gte("created_at", new Date(now - FOLLOWUP_WINDOW_DAYS * day).toISOString()).lte("created_at", new Date(now - FOLLOWUP_AFTER_DAYS * day).toISOString())
      .order("created_at", { ascending: true }).limit(200);
    const tenants = (data ?? []) as { id: string; name: string; created_at: string; created_by: string | null }[];
    const ids = tenants.map((t) => t.id);
    const done = await alreadySent(admin, "app.followup-personal", ids);
    const { data: demo } = ids.length ? await admin.from("tenant_members").select("tenant_id").eq("is_demo_account", true).in("tenant_id", ids) : { data: [] };
    const demoIds = new Set(((demo ?? []) as { tenant_id: string }[]).map((r) => r.tenant_id));
    const site = await siteUrl();
    const override = await loadEmailOverride("app.followup-personal");
    for (const t of tenants) {
      if (out.sent >= FOLLOWUP_PER_RUN) break;
      if (done.has(t.id) || demoIds.has(t.id) || !t.created_by) continue;
      out.considered++;
      const items = await count(admin, "items", t.id);
      const trackers = (await count(admin, "github_connections", t.id, (q) => q.neq("state", "disconnected"))) + (await count(admin, "jira_connections", t.id, (q) => q.neq("state", "disconnected")));
      if (!isFollowupCandidate({ createdAt: t.created_at, now, items, trackers })) continue;
      const { data: u } = await admin.auth.admin.getUserById(t.created_by);
      const owner = u?.user;
      const email = owner?.email;
      if (!owner || !email) continue;
      const mail = buildFollowupPersonalEmail({ name: firstNameOf(owner.user_metadata?.full_name), workspace: t.name, siteUrl: site, override });
      const res = await sendLogged("app.followup-personal", { to: email, replyTo: SUPPORT_CONTACT.email, fromName: FROM_NAME, ...mail }, { tenantId: t.id });
      if (res.ok) out.sent++;
    }
  } catch {
    console.error(JSON.stringify({ founderEmail: "followups-failed" }));
  }
  return out;
}
