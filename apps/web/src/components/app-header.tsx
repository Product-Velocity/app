import { AccountMenu } from "./account-menu";
import { HelpMenu } from "./help-menu";
import { BrandLogo } from "./brand-logo";
import { HeaderTabs } from "./header-tabs";
import { ScopeSwitcher } from "@/features/workspace/scope-switcher";

export type HeaderTenant = { tenantId: string; tenantName: string };
type Props = {
  tenantName: string;
  /** Set when the person belongs to more than one workspace: shows a switcher instead of the name. */
  memberships?: HeaderTenant[];
  activeTenantId?: string;
  switchAction?: (form: FormData) => void | Promise<void>;
  email: string;
  roleLabel: string;
  isApprover: boolean;
  /** Tab to mark as the current one; when left out it follows the address of the page. */
  current?: "grid" | "gantt" | "cards" | "leadership";
  /** Creators and admins get a link to the Trash in the account menu. */
  showTrash?: boolean;
};

/** Top bar following prototype boards 20 and 1: logo, workspace and scope, tabs, account menu. */
export function AppHeader({ tenantName, memberships, activeTenantId, switchAction, email, roleLabel, isApprover, current, showTrash }: Props) {
  return (
    <header className="topbar">
      <span className="brand-lockup">
        <BrandLogo />
        <strong className="brand">Product Velocity</strong>
      </span>

      <div className="scope">
        {memberships && memberships.length > 1 && switchAction ? (
          <form action={switchAction} className="inline-form">
            <label htmlFor="tenant" className="visually-hidden">Workspace</label>
            <select id="tenant" name="tenantId" defaultValue={activeTenantId}>
              {memberships.map((m) => <option key={m.tenantId} value={m.tenantId}>{m.tenantName}</option>)}
            </select>
            <button className="btn" type="submit">Switch</button>
          </form>
        ) : (
          <span>{tenantName}</span>
        )}
        <span aria-hidden="true">/</span>
        <ScopeSwitcher />
      </div>

      <HeaderTabs current={current} />

      <HelpMenu />
      <AccountMenu email={email} roleLabel={roleLabel} isApprover={isApprover} showTrash={showTrash} />
    </header>
  );
}
