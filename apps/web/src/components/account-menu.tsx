"use client";

import Link from "next/link";
import { useRef } from "react";
import { useDismiss } from "@/features/portfolio/use-dismiss";

const initials = (email: string) => {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
};

/** The avatar menu. It closes on a click anywhere else, on Escape, and as soon as a link in it is used. */
export function AccountMenu({ email, roleLabel, isApprover, showTrash, showAudit }: { email: string; roleLabel: string; isApprover: boolean; showTrash?: boolean; showAudit?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  // always listening: the "toggle" event that sets `open` arrives a moment after the click, and a fast second click must still close it
  useDismiss(ref, true, () => { if (ref.current?.open) close(); });
  return (
    <details
      ref={ref}
      className="account"
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
          <p className="menu-heading" id="menu-workspace">Workspace</p>
          <Link href="/settings/workspace" className="menu-link">Workspace settings</Link>
          <Link href="/settings/members" className="menu-link">Members</Link>
          <Link href="/settings/groups" className="menu-link">Initiative Groups</Link>
          {showAudit && <Link href="/settings/audit" className="menu-link">Audit log</Link>}
          <Link href="/alignment" className="menu-link">Alignment</Link>
          {showTrash && <Link href="/trash" className="menu-link">Trash</Link>}
        </div>
        <div role="group" aria-labelledby="menu-integrations">
          <p className="menu-heading" id="menu-integrations">Integrations</p>
          <Link href="/incoming" className="menu-link">Incoming issues</Link>
          <Link href="/settings/integrations/github" className="menu-link">GitHub</Link>
          <Link href="/settings/claude" className="menu-link">Connect Claude</Link>
        </div>
        <div role="group" aria-labelledby="menu-account">
          <p className="menu-heading" id="menu-account">Account</p>
          <Link href="/account" className="menu-link">Account</Link>
          <Link href="/settings/security" className="menu-link">Security</Link>
          <form action="/auth/sign-out" method="post">
            <button className="menu-link menu-button" type="submit">Sign out</button>
          </form>
        </div>
        <p className="account-version" title="Release log: docs/RELEASES.md">
          app v{process.env.NEXT_PUBLIC_APP_VERSION}
          {process.env.NEXT_PUBLIC_APP_BUILD ? ` · build ${process.env.NEXT_PUBLIC_APP_BUILD}` : ""}
        </p>
      </div>
    </details>
  );
}
