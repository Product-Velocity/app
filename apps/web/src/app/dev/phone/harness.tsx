"use client";

import { useMemo } from "react";
import { MemoryGateSource } from "@/features/gates/gate-source";
import { ForYou } from "@/features/phone/for-you";
import { PhoneQuickAdd } from "@/features/phone/phone-quick-add";
import { PhoneInitiatives } from "@/features/phone/phone-initiatives";
import { ItemPage } from "@/features/portfolio/item-page-client";
import { FollowProvider } from "@/features/phone/follow";
import { Insights } from "@/features/phone/insights-view";
import { PhoneTracker } from "@/features/phone/phone-tracker";
import type { ChangeSource } from "@/features/phone/use-phone-changes";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups, makeCardsHarness } from "../harness-data";

export function HarnessPhone({ n, screen }: { n: number; screen: string }) {
  const { controller } = useMemo(() => {
    const h = makeCardsHarness(n, "creator");
    if (screen === "insights") {
      // most initiatives are Active, with a spread of health and build progress; a few are not
      const health = ["On Track", "On Track", "At Risk", "Delayed", "Blocked", null];
      h.controller.rows.forEach((r, i) => {
        r.initiative_status = i % 7 === 6 ? "Completed" : "Active";
        r.health = health[i % health.length] ?? null;
        r.delivery_progress_pct = r.initiative_phase === "Build" ? (i * 13) % 100 : null;
        r.gate_status = i % 9 === 0 ? "In review" : r.gate_status;
      });
    }
    return h;
  }, [n, screen]);
  /** A fixture feed: a Health change on the first 20 initiatives, and a tracker status change on the first 14 (GitHub on even, Jira on odd). */
  const changeSource = useMemo<ChangeSource>(() => ({
    async load() {
      const now = Date.now();
      const feed = controller.rows.slice(0, 20).map((r, i) => ({ id: i + 1, item_id: r.id, entity: "items", field: "health", old: "On track", new: "At risk", at: new Date(now - i * 3_600_000).toISOString(), actor_id: null, via: "UI" }));
      const tracker = controller.rows.slice(0, 14).map((r, i) => i % 2 === 0
        ? { id: 100 + i, item_id: r.id, entity: "item_github_links", field: "gh_state", old: "open", new: "closed_completed", at: new Date(now - i * 1_800_000).toISOString(), actor_id: null, via: "GitHub webhook" }
        : { id: 100 + i, item_id: r.id, entity: "item_jira_links", field: "jira_status", old: "To Do", new: "In Review", at: new Date(now - i * 1_800_000).toISOString(), actor_id: null, via: "system" });
      const issues = new Map(controller.rows.slice(0, 14).map((r, i) => [r.id, i % 2 === 0 ? { tracker: "GitHub" as const, key: `acme/app#${100 + i}`, title: null, url: null } : { tracker: "Jira" as const, key: `PAY-${700 + i}`, title: `Payment retries ${i}`, url: null }]));
      return { feed: [...feed, ...tracker], issues };
    },
  }), [controller]);
  const followSave = useMemo(() => async (ids: string[]) => { (window as unknown as { __followed?: string[] }).__followed = ids; }, []);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [], views: [] }), { projects: harnessLookups.projects }), []);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit canAdmin={false}>
      <FollowProvider initial={controller.rows.slice(14, 16).map((r) => r.id)} save={followSave}><div className="shell"><main className="content">{screen === "add" ? <PhoneQuickAdd controller={controller} lookups={harnessLookups} tenantId="t1" />
          : screen === "for-you" ? <ForYou controller={controller} me="u1" tenantId="t1" lookups={harnessLookups} source={new MemoryGateSource()} />
          : screen === "item" ? <ItemPage controller={controller} lookups={harnessLookups} userId="u1" code="R-12" tenantId="t1" changeSource={changeSource} pageHref={(c) => `/dev/phone?screen=item&code=${c}`} backHref="/dev/phone" />
          : screen === "insights" ? <Insights controller={controller} lookups={harnessLookups} tenantId="t1" />
          : screen === "tracker" ? <PhoneTracker controller={controller} tenantId="t1" changeSource={changeSource} />
          : <PhoneInitiatives controller={controller} lookups={harnessLookups} me="u1" tenantId="t1" changeSource={changeSource} />}</main></div></FollowProvider>
    </WorkspaceProvider>
  );
}
