"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { stripAccountPath } from "@/lib/account-path";
import { OverflowBar, type OverflowItem } from "./overflow-bar";

/** Tabs of the product. The ones that are not built yet are shown muted with the phase they arrive in. */
const TABS: { label: string; href?: string; phase?: number; id: string }[] = [
  { label: "Grid", href: "/portfolio", id: "grid" },
  { label: "Gantt", href: "/gantt", id: "gantt" },
  { label: "Cards", href: "/cards", id: "cards" },
  { label: "Leadership", href: "/leadership", id: "leadership" },
  { label: "Planning", phase: 5, id: "planning" },
  { label: "Capacity", phase: 5, id: "capacity" },
  { label: "Alignment", phase: 5, id: "alignment" },
  { label: "Needs attention", href: "/attention", id: "attention" },
  { label: "Decisions", href: "/decisions", id: "decisions" },
  { label: "Reports", href: "/reports", id: "reports" },
];

export function HeaderTabs({ current, accountId, waiting }: { current?: "grid" | "gantt" | "cards" | "leadership" | "attention" | "decisions" | "reports"; accountId?: string; /** Gate requests waiting for a decision. */ waiting?: number }) {
  // the address may or may not carry /w/{account} on the server and the client; the tabs always do once the account is known
  const path = stripAccountPath(usePathname());
  const prefix = accountId ? `/w/${accountId}` : "";
  const active = current ?? (path.startsWith("/portfolio") ? "grid" : path.startsWith("/gantt") ? "gantt" : path.startsWith("/cards") ? "cards" : path.startsWith("/leadership") ? "leadership" : path.startsWith("/attention") ? "attention" : path.startsWith("/decisions") ? "decisions" : path.startsWith("/reports") ? "reports" : null);
  // what does not fit moves into "More": the tabs that are not built yet first, then from the right; the open tab always stays
  const items: OverflowItem[] = TABS.map((t, i) => {
    const on = active === t.id;
    const badge = t.id === "decisions" && waiting ? <span className="tab-badge"><span aria-hidden="true">{waiting}</span><span className="visually-hidden"> waiting for a decision</span></span> : null;
    return {
      id: t.id,
      rank: t.href ? i : 100 + i,
      pinned: on,
      node: t.href ? (
        <Link href={`${prefix}${t.href}`} className={on ? "tab tab-active" : "tab"} aria-current={on ? "page" : undefined}>
          {t.label}
          {badge}
        </Link>
      ) : (
        <span className="tab tab-later" aria-disabled="true" title={`Arrives in phase ${t.phase}`}>
          {t.label}
          <span className="visually-hidden"> (arrives in phase {t.phase})</span>
        </span>
      ),
      entry: t.href
        ? { label: <>{t.label}{badge}</>, href: `${prefix}${t.href}`, current: on }
        : { label: <>{t.label} <span className="visually-hidden">(arrives in phase {t.phase})</span></>, disabled: true, title: `Arrives in phase ${t.phase}` },
    };
  });
  return (
    <nav aria-label="Main" className="tabs tabs-ov">
      <OverflowBar items={items} label="Tabs" moreLabel="More tabs" className="ov-tabs" />
    </nav>
  );
}
