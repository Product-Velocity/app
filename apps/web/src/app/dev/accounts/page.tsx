import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { PlatformBanner } from "@/components/platform-banner";
import { AuditView } from "@/components/audit-view";
import { AccountsTable } from "@/app/platform/accounts-table";
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
            <AccountsTable rows={[
              { tenant_id: A, name: "Meridian Media", plan: "Trial", owner_email: "lena@meridian.test", member_count: 12, project_count: 4, last_activity: "2026-10-28T14:03:22Z", access_override: null },
              { tenant_id: B, name: "Northwind Agency", plan: "Team", owner_email: "ines@northwind.test", member_count: 5, project_count: 2, last_activity: null, access_override: "read_only" },
            ]} />
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
