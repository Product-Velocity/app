"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspaceController } from "./portfolio-client";
import { ItemPanel } from "./item-panel";
import type { PortfolioController } from "./controller";
import type { Lookups } from "./types";

/** The item as a page of its own at /portfolio/R-12: same panel, same autosave and undo, shareable address. */
export function ItemPageClient({ tenantId, role, userId, lookups, code }: { tenantId: string; role: string; userId: string; lookups: Lookups; code: string }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups);
  if (state.kind === "loading") return <p role="status" className="muted">Loading {code}…</p>;
  if (state.kind === "error") {
    return <div role="alert" className="error">Could not load the initiative: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  }
  return <ItemPage controller={state.controller} lookups={lookups} userId={userId} code={code} />;
}

export function ItemPage({ controller, lookups, userId, code, pageHref = (c) => `/portfolio/${encodeURIComponent(c)}`, backHref = "/portfolio" }: { controller: PortfolioController; lookups: Lookups; userId: string; code: string; pageHref?: (code: string) => string; backHref?: string }) {
  const router = useRouter();
  const row = controller.rows.find((r) => r.item_code.toLowerCase() === code.toLowerCase());
  const index = row ? controller.rows.indexOf(row) : -1;
  const position = useMemo(() => (index >= 0 ? { index, total: controller.rows.length } : undefined), [index, controller]);

  // J and K walk through the roadmap in rank order, like in the panel beside the grid
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || index < 0) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      const to = e.key === "j" || e.key === "J" ? index + 1 : e.key === "k" || e.key === "K" ? index - 1 : null;
      if (to === null || to < 0 || to >= controller.rows.length) return;
      e.preventDefault();
      router.push(pageHref(controller.rows[to]!.item_code));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [controller, index, router, pageHref]);

  if (!row) return <div className="notice-box"><p>There is no initiative {code} in this workspace, or you cannot see it.</p><Link href={backHref}>Back to the roadmap</Link></div>;
  return (
    <ItemPanel
      key={row.id} controller={controller} lookups={lookups} itemId={row.id} me={userId} mode="page" position={position} pageHref={pageHref} backHref={backHref}
      onPrev={index > 0 ? () => router.push(pageHref(controller.rows[index - 1]!.item_code)) : undefined}
      onNext={index < controller.rows.length - 1 ? () => router.push(pageHref(controller.rows[index + 1]!.item_code)) : undefined}
    />
  );
}
