"use client";

import Link from "next/link";
import { useRef } from "react";
import { useDismiss } from "@/features/portfolio/use-dismiss";
import { AccountVersionFooter, checkVersionNow } from "./version-status";

const initials = (email: string) => {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
};

type MenuProps = {
  email: string;
  roleLabel: string;
  isApprover: boolean;
  /** Creators and admins may use the Trash. */
  showTrash?: boolean;
  /** Human admins of this workspace: the "Workspace admin" section. */
  isAdmin?: boolean;
  /** Platform owner (Product Velocity staff): the "Platform owner" section. */
  isPlatformAdmin?: boolean;
  /** A platform admin working inside a customer account with granted access: only the audit log of that account. */
  showAudit?: boolean;
};

/**
 * The avatar menu (issue #286). Four sections, in this order, each a labelled group; a section a person may not use is not shown:
 *  1. This workspace: what every member works with (read only pages for people who cannot change them).
 *  2. You: your own login, security and AI assistants.
 *  3. Workspace admin: settings, audit log and integrations (admins only).
 *  4. Platform owner: the cross-account console (platform admins only).
 * It closes on a click anywhere else, on Escape, and as soon as a link in it is used.
 */
export function AccountMenu({ email, roleLabel, isApprover, showTrash, isAdmin, isPlatformAdmin, showAudit }: MenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  // always listening: the "toggle" event that sets `open` arrives a moment after the click, and a fast second click must still close it
  useDismiss(ref, true, () => { if (ref.current?.open) close(); });
  const platformAuditOnly = !isAdmin && !isPlatformAdmin && showAudit;
  return (
    <details
      ref={ref}
      className="account"
      onToggle={() => { if (ref.current?.open) void checkVersionNow(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && ref.current?.open) { e.stopPropagation(); close(); ref.current?.querySelector("summary")?.focus(); } }}
      onClick={(e) => { if ((e.target as HTMLElement).closest("a")) close(); }}
    >
      <summary>
        <span className="avatar">{initials(email)}</span>
        <span className="visually-hidden"> account menu for {email}</span>
      </summary>
      <div className="account-menu">
        <p className="account-who">
          <span title={email}>{email}</span>
          <span className="muted">{roleLabel}{isApprover ? " · Approver" : ""}</span>
        </p>
        <div role="group" aria-labelledby="menu-workspace">
          <p className="menu-heading" id="menu-workspace">This workspace</p>
          <Link href="/incoming" className="menu-link">Incoming issues</Link>
          <Link href="/alignment" className="menu-link">Alignment</Link>
          {showTrash && <Link href="/trash" className="menu-link">Trash</Link>}
          <Link href="/settings/members" className="menu-link">Members</Link>
          <Link href="/settings/groups" className="menu-link">Initiative Groups</Link>
          <Link href="/settings/company-profile" className="menu-link">Company profile</Link>
        </div>
        <div role="group" aria-labelledby="menu-you">
          <p className="menu-heading" id="menu-you">You</p>
          <Link href="/account" className="menu-link">Account</Link>
          <Link href="/settings/security" className="menu-link">Security</Link>
          <Link href="/settings/claude" className="menu-link">Connect an AI assistant</Link>
        </div>
        {isAdmin && (
          <div role="group" aria-labelledby="menu-admin">
            <p className="menu-heading" id="menu-admin">Workspace admin</p>
            <Link href="/settings/workspace" className="menu-link">Workspace settings</Link>
            <Link href="/settings/audit" className="menu-link">Audit log</Link>
            <Link href="/settings/integrations/github" className="menu-link">GitHub</Link>
            <Link href="/settings/integrations/jira" className="menu-link">Jira</Link>
          </div>
        )}
        {(isPlatformAdmin || platformAuditOnly) && (
          <div role="group" aria-labelledby="menu-platform">
            <p className="menu-heading" id="menu-platform">Platform owner</p>
            {isPlatformAdmin && <Link href="/platform" className="menu-link">All accounts console</Link>}
            {showAudit && !isAdmin && <Link href="/settings/audit" className="menu-link">This account&rsquo;s audit log</Link>}
            {isPlatformAdmin && <Link href="/platform/audit" className="menu-link">Platform audit log</Link>}
            {isPlatformAdmin && <Link href="/platform/settings" className="menu-link">Access settings</Link>}
          </div>
        )}
        <form action="/auth/sign-out" method="post" className="menu-signout">
          <button className="menu-link menu-button" type="submit">Sign out</button>
        </form>
        <AccountVersionFooter onCloseMenu={close} />
      </div>
    </details>
  );
}
