import { requireWorkspace } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import { AppHeader } from "@/components/app-header";
import { switchTenant } from "./actions";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { user, memberships, active } = await requireWorkspace("/portfolio");
  return (
    <div className="shell">
      <AppHeader
        tenantName={active.tenantName}
        memberships={memberships}
        activeTenantId={active.tenantId}
        switchAction={switchTenant}
        email={user.email ?? ""}
        roleLabel={ROLE_LABEL[active.role]}
        isApprover={active.isApprover}
      />
      <main className="content">{children}</main>
    </div>
  );
}
