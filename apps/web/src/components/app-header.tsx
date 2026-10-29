import { AccountMenu } from "./account-menu";
import { HelpMenu } from "./help-menu";
import { HelpGuide } from "./help-guide";
import { TextSizeControl } from "./text-size-control";
import { BrandLogo } from "./brand-logo";
import { HeaderTabs } from "./header-tabs";
import { ScopeSwitcher } from "@/features/workspace/scope-switcher";
import { AccountSwitcher, type SwitcherAccount } from "./account-switcher";
type Props = {
  tenantName: string;
  /** The accounts the person can open; more than one (or a platform role) turns the name into the account switcher. */
  accounts?: SwitcherAccount[];
  activeTenantId?: string;
  isPlatformAdmin?: boolean;
  email: string;
  roleLabel: string;
  isApprover: boolean;
  /** Saved text size in percent; 100 when left out. */
  textSize?: number;
  /** Tab to mark as the current one; when left out it follows the address of the page. */
  current?: "grid" | "gantt" | "cards" | "leadership" | "reports";
  /** Creators and admins get a link to the Trash in the account menu. */
  showTrash?: boolean;
  /** Admins (and platform admins inside the account) get the Audit log link. */
  showAudit?: boolean;
};

/** Top bar following prototype boards 20 and 1: logo, workspace and scope, tabs, account menu. */
export function AppHeader({ tenantName, accounts, activeTenantId, isPlatformAdmin, email, roleLabel, isApprover, textSize, current, showTrash, showAudit }: Props) {
  return (
    <header className="topbar">
      <span className="brand-lockup">
        <BrandLogo />
      </span>

      <div className="scope">
        {activeTenantId && accounts ? (
          <AccountSwitcher accounts={accounts} activeId={activeTenantId} activeName={tenantName} isPlatformAdmin={!!isPlatformAdmin} />
        ) : (
          <span>{tenantName}</span>
        )}
        <span aria-hidden="true">/</span>
        <ScopeSwitcher />
      </div>

      <HeaderTabs current={current} accountId={activeTenantId} />

      <TextSizeControl initial={textSize} />
      <HelpMenu />
      <HelpGuide />
      <AccountMenu email={email} roleLabel={roleLabel} isApprover={isApprover} showTrash={showTrash} showAudit={showAudit} />
    </header>
  );
}
