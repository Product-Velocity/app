import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import { DatePrefs } from "@/components/date-prefs";
import { profileFromMetadata } from "@/lib/account";
import { AppHeader } from "@/components/app-header";
import { SupabaseWorkspaceProvider } from "@/features/workspace/provider";
import { canEditItems } from "@pv/domain";
import { PlatformBanner } from "@/components/platform-banner";
import { isPlatformAdmin, loginIsStale } from "@/lib/session";
import { LastLocationTracker, UserPrefsProvider } from "@/components/user-prefs";
import { lastLocationFromMetadata, panelWidthFromMetadata, textSizeFromMetadata } from "@/lib/user-prefs";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, memberships, active } = await requireWorkspace("/portfolio");
  const staleLogin = !active.platform && loginIsStale(active.lastLoginAt);
  const [{ data: projects }, platformAdmin] = await Promise.all([
    supabase.from("projects").select("id, name").eq("tenant_id", active.tenantId).order("name"),
    isPlatformAdmin(supabase),
    // last login is per account (R-111): opening an account records it, at most once a minute
    staleLogin ? supabase.rpc("touch_membership_login", { p_tenant: active.tenantId }) : Promise.resolve(null),
  ]);
  // admins are alerted in the app when people have asked to join (FR-2.2); the email goes out when the request is made
  const requested = active.role === "admin" && !active.platform
    ? (await supabase.from("tenant_members").select("id", { count: "exact", head: true }).eq("tenant_id", active.tenantId).eq("status", "requested")).count ?? 0
    : 0;
  return (
    <SupabaseWorkspaceProvider tenantId={active.tenantId} userId={user.id} projects={(projects ?? []) as { id: string; name: string }[]} canEdit={canEditItems(active.role)} canAdmin={active.role === "admin"}>
    <UserPrefsProvider panelWidth={panelWidthFromMetadata(user.user_metadata)}>
    <LastLocationTracker initial={lastLocationFromMetadata(user.user_metadata, active.tenantId)} />
    <DatePrefs format={profileFromMetadata(user.user_metadata).dateFormat} />
    <div className="shell" style={{ zoom: textSizeFromMetadata(user.user_metadata) / 100, ["--text-zoom" as string]: textSizeFromMetadata(user.user_metadata) / 100 }}>
      <AppHeader
        tenantName={active.tenantName}
        accounts={memberships.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenantName, lastLoginAt: m.lastLoginAt }))}
        activeTenantId={active.tenantId}
        isPlatformAdmin={platformAdmin}
        email={user.email ?? ""}
        roleLabel={active.platform ? "Platform admin" : ROLE_LABEL[active.role]}
        isApprover={active.isApprover}
        textSize={textSizeFromMetadata(user.user_metadata)}
        showTrash={canEditItems(active.role)}
        showAudit={active.role === "admin" || !!active.platform}
      />
      {active.platform && <PlatformBanner platform={active.platform} accountName={active.tenantName} />}
      {requested > 0 && (
        <div className="notice-box" role="status">
          <Link href="/settings/members?status=requested">
            {requested === 1 ? "1 person has asked to join" : `${requested} people have asked to join`} {active.tenantName}. Review {requested === 1 ? "the request" : "the requests"}.
          </Link>
        </div>
      )}
      <main className="content">{children}</main>
    </div>
    </UserPrefsProvider>
    </SupabaseWorkspaceProvider>
  );
}
