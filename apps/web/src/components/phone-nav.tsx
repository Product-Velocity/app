"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { stripAccountPath } from "@/lib/account-path";
import { PHONE_TABS, phoneTabFor } from "@/features/phone/nav";

/** The bottom bar on a phone (CSS shows it under 700 px only). */
export function PhoneNav({ accountId, waiting }: { accountId?: string; waiting?: number }) {
  const active = phoneTabFor(stripAccountPath(usePathname()));
  const prefix = accountId ? `/w/${accountId}` : "";
  return (
    <nav aria-label="Main (phone)" className="phone-nav">
      {PHONE_TABS.map((t) => (
        <Link key={t.id} href={`${prefix}${t.href}`} className={active === t.id ? "phone-tab phone-tab-on" : "phone-tab"} aria-current={active === t.id ? "page" : undefined}>
          {t.label}
          {t.id === "decisions" && waiting ? <span className="tab-badge"><span aria-hidden="true">{waiting}</span><span className="visually-hidden"> waiting for a decision</span></span> : null}
        </Link>
      ))}
    </nav>
  );
}
