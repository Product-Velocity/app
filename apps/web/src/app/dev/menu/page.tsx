import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { HarnessShell } from "../accounts/shell";

/**
 * Test page for the account menu (issue #286) with fixed data. Disabled unless the build sets NEXT_PUBLIC_E2E_HARNESS=1.
 * ?who=viewer | creator | admin (default) | platform (platform owner who is also admin of this workspace) | inside (platform admin with access to a customer account)
 */
const A = "0b6f2a1c-3d4e-4f50-8a9b-1c2d3e4f5a6b";

export default async function MenuHarness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  const who = (await searchParams).who ?? "admin";
  const admin = who === "admin" || who === "platform";
  const label = { viewer: "Viewer", creator: "Creator", admin: "Admin", platform: "Admin", inside: "Platform admin" }[who] ?? "Admin";
  return (
    <HarnessShell>
      <div className="shell">
        <AppHeader
          tenantName="Meridian Media" accounts={[{ tenantId: A, tenantName: "Meridian Media", lastLoginAt: null }]} activeTenantId={A}
          isPlatformAdmin={who === "platform" || who === "inside"} email="lena@meridian.test" roleLabel={label} isApprover={admin} current="grid"
          showTrash={who !== "viewer"} showAudit={admin || who === "inside"} isAdmin={admin}
        />
        <main className="content"><h1>Menu</h1></main>
      </div>
    </HarnessShell>
  );
}
