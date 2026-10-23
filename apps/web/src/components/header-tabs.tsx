"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tabs of the product. The ones that are not built yet are shown muted with the phase they arrive in. */
const TABS: { label: string; href?: string; phase?: number; id: string }[] = [
  { label: "Grid", href: "/portfolio", id: "grid" },
  { label: "Gantt", href: "/gantt", id: "gantt" },
  { label: "Cards", phase: 2, id: "cards" },
  { label: "Planning", phase: 5, id: "planning" },
  { label: "Capacity", phase: 5, id: "capacity" },
  { label: "Alignment", phase: 5, id: "alignment" },
  { label: "Reports", phase: 6, id: "reports" },
];

export function HeaderTabs({ current }: { current?: "grid" | "gantt" }) {
  const path = usePathname();
  const active = current ?? (path.startsWith("/portfolio") ? "grid" : path.startsWith("/gantt") ? "gantt" : null);
  return (
    <nav aria-label="Main" className="tabs">
      {TABS.map((t) =>
        t.href ? (
          <Link key={t.id} href={t.href} className={active === t.id ? "tab tab-active" : "tab"} aria-current={active === t.id ? "page" : undefined}>
            {t.label}
          </Link>
        ) : (
          <span key={t.id} className="tab tab-later" aria-disabled="true" title={`Arrives in phase ${t.phase}`}>
            {t.label}
            <span className="visually-hidden"> (arrives in phase {t.phase})</span>
          </span>
        ),
      )}
    </nav>
  );
}
