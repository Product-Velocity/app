import { requireWorkspace } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import { DatePrefs } from "@/components/date-prefs";
import { profileFromMetadata } from "@/lib/account";
import { AppHeader } from "@/components/app-header";
import { SupabaseWorkspaceProvider } from "@/features/workspace/provider";
import { canEditItems } from "@pv/domain";
import { switchTenant } from "./actions";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, memberships, active } = await requireWorkspace("/portfolio");
  const { data: projects } = await supabase.from("projects").select("id, name").eq("tenant_id", active.tenantId).order("name");
  return (
    <SupabaseWorkspaceProvider tenantId={active.tenantId} userId={user.id} projects={(projects ?? []) as { id: string; name: string }[]} canEdit={canEditItems(active.role)} canAdmin={active.role === "admin"}>
    <DatePrefs format={profileFromMetadata(user.user_metadata).dateFormat} />
    <div className="shell">
      <AppHeader
        tenantName={active.tenantName}
        memberships={memberships}
        activeTenantId={active.tenantId}
        switchAction={switchTenant}
        email={user.email ?? ""}
        roleLabel={ROLE_LABEL[active.role]}
        isApprover={active.isApprover}
        showTrash={canEditItems(active.role)}
      />
      <main className="content">{children}</main>
    </div>
    </SupabaseWorkspaceProvider>
  );
}
