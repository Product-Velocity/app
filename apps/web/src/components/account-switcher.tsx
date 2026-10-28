"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { filterOptions } from "@pv/domain";
import { menuSearchKeys, NoResults, SearchInput } from "@/components/search-list";
import { useMenuBlur } from "@/features/portfolio/use-menu-blur";
import { useDismiss } from "@/features/portfolio/use-dismiss";
import { tabHref } from "@/lib/account-path";

export type SwitcherAccount = { tenantId: string; tenantName: string; lastLoginAt: string | null };

const RECENT = 3;

/**
 * First breadcrumb segment (R-111 FR-1): the accounts this person can open, with search, a Recent section and, for platform admins, a link
 * to the All accounts console. The page keeps its tab: /w/{account}/gantt becomes /w/{other}/gantt. A person with one account (and no
 * platform role) just sees the name.
 */
export function AccountSwitcher({ accounts, activeId, activeName, isPlatformAdmin }: {
  accounts: SwitcherAccount[]; activeId: string; activeName: string; isPlatformAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const menuBlur = useMenuBlur(() => setOpen(false));
  useDismiss(ref, open, () => setOpen(false));

  const recent = useMemo(
    () => accounts.filter((a) => a.lastLoginAt && a.tenantId !== activeId).sort((a, b) => (b.lastLoginAt ?? "").localeCompare(a.lastLoginAt ?? "")).slice(0, RECENT),
    [accounts, activeId],
  );
  const searching = query.trim().length > 0;
  const shown = filterOptions(accounts.map((a) => ({ a, label: a.tenantName })), query).map((x) => x.a);
  const shownRecent = searching ? [] : recent;

  if (accounts.length <= 1 && !isPlatformAdmin) return <span data-testid="account-name">{activeName}</span>;

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? []);
  const close = (refocus = false) => { setOpen(false); if (refocus) ref.current?.querySelector<HTMLElement>(".scope-chip")?.focus(); };
  const go = (id: string) => { close(true); if (id !== activeId) router.push(tabHref(id, pathname)); };
  const row = (a: SwitcherAccount, key: string) => (
    <button key={key} type="button" role="menuitemradio" aria-checked={a.tenantId === activeId} className="scope-item" onClick={() => go(a.tenantId)}>
      <span>{a.tenantName}</span><span className="scope-meta">{a.tenantId === activeId ? "✓" : ""}</span>
    </button>
  );

  return (
    <div
      ref={ref}
      className="scope-switcher"
      {...menuBlur}
      onKeyDown={(e) => {
        if (!open) return;
        const els = items();
        const at = els.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape") { e.stopPropagation(); close(true); }
        else if (e.key === "ArrowDown") { e.preventDefault(); els[Math.min(els.length - 1, at + 1)]?.focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); els[Math.max(0, at - 1)]?.focus(); }
      }}
    >
      <button type="button" className="scope-chip" aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${activeName}. Switch account`} data-testid="account-chip" onClick={() => { setOpen((o) => !o); setQuery(""); }}>
        {activeName} ▾
      </button>
      {open && (
        <div className="scope-menu" data-testid="account-menu">
          <SearchInput value={query} onChange={setQuery} label="Search accounts" placeholder="Search accounts…" onKeyDown={(e) => { if (e.key === "Enter") menuSearchKeys(e); }} />
          <div role="menu" aria-label="Accounts">
            {shownRecent.length > 0 && <p className="scope-head">Recent</p>}
            {shownRecent.map((a) => row(a, `r-${a.tenantId}`))}
            {shown.length > 0 && <p className="scope-head">{accounts.length === 1 ? "Your account" : "All your accounts"}</p>}
            {shown.map((a) => row(a, a.tenantId))}
            {!searching && (
              <>
                <p className="scope-head">More</p>
                <Link role="menuitem" href="/onboarding?new=1" className="scope-item scope-link" data-testid="new-account-link" onClick={() => close()}>+ New account</Link>
                {isPlatformAdmin && (
                  <Link role="menuitem" href="/platform" className="scope-item scope-link" data-testid="all-accounts-link" onClick={() => close()}>All accounts console (platform admins)</Link>
                )}
              </>
            )}
          </div>
          {shown.length === 0 && <NoResults query={query} />}
        </div>
      )}
    </div>
  );
}
