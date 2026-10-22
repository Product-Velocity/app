import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import { switchTenant } from "./actions";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { user, memberships, active } = await requireWorkspace("/home");
  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">Product Velocity</strong>
        {memberships.length > 1 ? (
          <form action={switchTenant} className="inline-form">
            <label htmlFor="tenant" className="visually-hidden">
              Workspace
            </label>
            <select id="tenant" name="tenantId" defaultValue={active.tenantId}>
              {memberships.map((m) => (
                <option key={m.tenantId} value={m.tenantId}>
                  {m.tenantName}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              Switch
            </button>
          </form>
        ) : (
          <span>{active.tenantName}</span>
        )}
        <nav aria-label="Main" className="nav">
          <Link href="/home">Home</Link>
          <Link href="/settings/members">Members</Link>
          <Link href="/settings/security">Security</Link>
        </nav>
        <span className="spacer" />
        <span className="muted" title={user.email ?? ""}>
          {ROLE_LABEL[active.role]}
          {active.isApprover ? " · Approver" : ""}
        </span>
        <form action="/auth/sign-out" method="post">
          <button className="btn" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
