import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { PlatformBanner } from "@/components/platform-banner";
import { AuditView } from "@/components/audit-view";
import { AccountsGrid } from "@/app/platform/accounts-grid";
import type { AccountRow, MemberRow } from "@/app/platform/accounts-model";
import { LinkedEmails } from "@/app/(workspace)/account/forms";
import type { AuditRow } from "@/lib/audit-log";
import { HarnessShell } from "./shell";

/**
 * Test page for R-111 with fictional data (Meridian Media and friends): the account switcher, the platform banner, the audit log table
 * and the All accounts console. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1.
 * ?accounts=1 (one account) | 3 (default); ?platform=1 (platform admin, rw) | ro (read-only entry); ?view=audit|console|emails
 */
const A = "0b6f2a1c-3d4e-4f50-8a9b-1c2d3e4f5a6b", B = "f1e2d3c4-b5a6-4978-8a69-5b4c3d2e1f00", C = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ALL = [
  { tenantId: A, tenantName: "Meridian Media", lastLoginAt: "2026-10-28T09:00:00Z" },
  { tenantId: B, tenantName: "Northwind Agency", lastLoginAt: "2026-10-27T09:00:00Z" },
  { tenantId: C, tenantName: "Harbor Logistics", lastLoginAt: null },
];

const base = { tenant_id: A, entity: "items", entity_id: "i1", field: "initiative_name", actor_id: "u", project_id: "p1", batch_id: null, via: "UI", screen: "grid" };
const AUDIT: AuditRow[] = [
  { ...base, id: 5, old: "Checkout redesign", new: "Checkout redesign v2", actor_name: "Pat Owner", actor_email: "pat@productvelocity.test", actor_role: "platform_admin", actor_platform_admin: true, at: "2026-10-28T14:03:22Z" },
  { ...base, id: 4, old: "Q4 plan", new: "Q4 plan (final)", actor_name: "Lena Admin", actor_email: "lena@meridian.test", actor_role: "admin", actor_platform_admin: false, at: "2026-10-28T13:40:10Z" },
  { ...base, id: 3, entity: "platform_access", entity_id: "e1", field: "entered", old: null, new: { access_level: "read_write" }, actor_name: "Pat Owner", actor_email: "pat@productvelocity.test", actor_role: "platform_admin", actor_platform_admin: true, project_id: null, screen: "platform", at: "2026-10-28T14:02:00Z" },
  ...[2, 1].map((n) => ({ ...base, id: n, entity: "tenant_members", entity_id: `m${n}`, field: "status", old: "requested", new: "active", actor_name: "Lena Admin", actor_email: "lena@meridian.test", actor_role: "admin", actor_platform_admin: false, project_id: null, batch_id: "b3c0ffee-0000-4000-8000-000000000001", screen: "members", at: "2026-10-27T10:00:00Z" })),
];

const CONSOLE_ROWS: AccountRow[] = [
  { tenant_id: A, name: "Meridian Media", plan: "Trial", owner_email: "lena@meridian.test", owner_name: "Lena Ortiz", member_count: 12, requested_count: 1, invited_count: 2, project_count: 4, item_count: 187, last_activity: "2026-11-21T14:03:22Z", last_login_at: "2026-11-22T08:10:00Z", access_override: null, created_at: "2026-09-02T09:00:00Z", company_url: "https://www.meridian.test/about", country: "United Kingdom", claude_enabled: true, ai_agents: [{ name: "Claude Desktop", connections: 3, last_used_at: "2026-11-21T10:00:00Z", calls: 412 }, { name: "Cursor", connections: 1, last_used_at: null, calls: 0 }], github_state: "connected", jira_state: null, suspended_at: null },
  { tenant_id: B, name: "Northwind Agency", plan: "Team", owner_email: "ines@northwind.test", owner_name: "Ines Costa", member_count: 5, requested_count: 0, invited_count: 0, project_count: 2, item_count: 23, last_activity: null, last_login_at: null, access_override: "read_only", created_at: "2026-10-12T09:00:00Z", company_url: null, country: null, claude_enabled: false, ai_agents: [], github_state: null, jira_state: "reconnect_needed", suspended_at: "2026-11-20T09:00:00Z" },
  { tenant_id: "7c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e9f", name: "Harbor Logistics", plan: "Trial", owner_email: "sam@harbor.test", owner_name: null, member_count: 1, requested_count: 0, invited_count: 1, project_count: 1, item_count: 4, last_activity: "2026-11-20T09:00:00Z", last_login_at: "2026-11-20T09:00:00Z", access_override: null, created_at: "2026-11-18T09:00:00Z", company_url: "https://harbor.test", country: "Norway", claude_enabled: true, ai_agents: [], github_state: null, jira_state: null, suspended_at: null },
];
const CONSOLE_MEMBERS: MemberRow[] = [
  { kind: "member", member_id: "m1", invitation_id: null, email: "lena@meridian.test", name: "Lena Ortiz", role: "admin", is_approver: true, is_service_account: false, status: "active", created_at: "2026-09-02T09:00:00Z", last_login_at: "2026-11-22T08:10:00Z", expires_at: null, email_status: null, ai_agents: ["Claude Desktop"] },
  { kind: "member", member_id: "m2", invitation_id: null, email: "sam@meridian.test", name: "Sam Lee", role: "creator", is_approver: false, is_service_account: false, status: "paused", created_at: "2026-09-04T09:00:00Z", last_login_at: null, expires_at: null, email_status: null, ai_agents: [] },
  { kind: "member", member_id: "m3", invitation_id: null, email: "new@meridian.test", name: "new", role: "viewer", is_approver: false, is_service_account: false, status: "requested", created_at: "2026-11-20T09:00:00Z", last_login_at: null, expires_at: null, email_status: null, ai_agents: [] },
  { kind: "invitation", member_id: null, invitation_id: "i1", email: "pending@meridian.test", name: null, role: "commenter", is_approver: false, is_service_account: false, status: "invited", created_at: "2026-11-19T09:00:00Z", last_login_at: null, expires_at: "2026-11-26T09:00:00Z", email_status: "sent", ai_agents: [] },
];

export default async function AccountsHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const q = await searchParams;
  const accounts = ALL.slice(0, q.accounts === "1" ? 1 : 3);
  const platform = q.platform === "1" || q.platform === "ro";
  const view = q.view ?? "header";
  return (
    <HarnessShell>
    <div className="shell">
      <AppHeader
        tenantName="Meridian Media" accounts={accounts} activeTenantId={A} isPlatformAdmin={platform}
        email="lena@meridian.test" roleLabel={platform ? "Platform admin" : "Admin"} isApprover={false} current="grid" showAudit
      />
      {platform && (
        <PlatformBanner platform={{ level: q.platform === "ro" ? "read_only" : "read_write", adminName: "Pat Owner", adminEmail: "pat@productvelocity.test", expiresAt: "2026-10-28T22:00:00Z" }} accountName="Meridian Media" />
      )}
      <main className="content">
        {view === "audit" && (
          <div className="page-wide">
            <h1>Audit log</h1>
            <AuditView rows={AUDIT} lookup={{ projects: { p1: "Platform" }, objects: { i1: "R-12 Checkout redesign" } }} filters={{}} basePath="/dev/accounts" exportPath="/dev/accounts/export" projects={[{ id: "p1", name: "Platform" }]} showAccount={false} more={false} timeZone="UTC" />
          </div>
        )}
        {view === "console" && (
          <div className="page-wide">
            <h1>All accounts</h1>
            <AccountsGrid rows={CONSOLE_ROWS} emailEnabled fixtureMembers={CONSOLE_MEMBERS} />
          </div>
        )}
        {view === "emails" && (
          <div className="page-narrow">
            <h1>Account</h1>
            <h2>Linked emails</h2>
            <div className="card">
              <LinkedEmails emails={[
                { email: "sam@freelance.test", is_sign_in: true, verified: true, use_for_notifications: false },
                { email: "sam@meridian.test", is_sign_in: false, verified: true, use_for_notifications: true },
                { email: "sam@northwind.test", is_sign_in: false, verified: false, use_for_notifications: false },
              ]} />
            </div>
          </div>
        )}
      </main>
    </div>
    </HarnessShell>
  );
}
