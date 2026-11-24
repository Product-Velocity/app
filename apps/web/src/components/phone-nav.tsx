"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { stripAccountPath } from "@/lib/account-path";
import { PHONE_TABS, phoneTabFor, type PhoneTab } from "@/features/phone/nav";

/** Simple line icons, drawn on a 24 px grid; the label always sits under them, so an icon is never the only signal. */
const ICON: Record<PhoneTab["id"], React.ReactNode> = {
  initiatives: <path d="M4 6h16M4 12h16M4 18h10" />,
  decide: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  add: <path d="M12 5v14M5 12h14" />,
  tracker: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  insights: <path d="M5 20V10M12 20V4M19 20v-7" />,
};

/** The bottom bar on a phone (CSS shows it under 700 px only): icon over label, the Add button raised in the middle. */
export function PhoneNav({ accountId, waiting }: { accountId?: string; waiting?: number }) {
  const active = phoneTabFor(stripAccountPath(usePathname()));
  const prefix = accountId ? `/w/${accountId}` : "";
  return (
    <nav aria-label="Main (phone)" className="phone-nav">
      {PHONE_TABS.map((t) => (
        <Link key={t.id} href={`${prefix}${t.href}`} className={`phone-tab phone-tab-${t.id}${active === t.id ? " phone-tab-on" : ""}`} aria-current={active === t.id ? "page" : undefined}>
          <span className="phone-tab-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICON[t.id]}</svg>
            {t.id === "decide" && waiting ? <span className="tab-badge phone-badge"><span aria-hidden="true">{waiting > 99 ? "99+" : waiting}</span><span className="visually-hidden"> waiting for a decision</span></span> : null}
          </span>
          <span className="phone-tab-label">{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
