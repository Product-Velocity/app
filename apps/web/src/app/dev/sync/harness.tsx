"use client";

import { useCallback, useMemo, useState } from "react";
import { GithubPushDialog } from "@/features/portfolio/github-push-dialog";
import { MemoryIncomingSource } from "@/features/incoming/memory-source";
import { GITHUB_TERMS, JIRA_TERMS, type IncomingIssue } from "@/features/incoming/types";
import type { NewItemsConfig } from "@/features/portfolio/new-items";
import type { SyncApi } from "@/lib/tracker/sync-router";
import type { PlanItem, ReceiveItem, RemovedApi, RemovedCard } from "@/lib/github/push-types";

const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const CODES = ["R-1", "R-2", "R-3"];
const card = (id: string, n: number): ReceiveItem => ({ id, code: CODES[n]!, name: `Initiative ${n + 1}`, status: "in_step", received: [], issueNumber: 100 + n, issueUrl: null });
const plan = (id: string, n: number): PlanItem => ({ id, code: CODES[n]!, name: `Initiative ${n + 1}`, project: "Platform", repo: "acme/app", action: "update", title: `${CODES[n]}: Initiative ${n + 1}`, labels: [], block: "", issueNumber: 100 + n, issueUrl: null });

/** Jira scenario: R-1 received a status change, R-2 is owned by Product Velocity with a name to send and a description changed in Jira, R-3 was not found. */
const jiraPreview = (ids: string[]) => ({
  ok: true as const,
  account: "Acme Jira",
  send: ids.filter((id) => id === IDS[1]).map((id): PlanItem => ({ id, tracker: "jira", issueLabel: "PLAT-13", code: "R-2", name: "Initiative 2", project: "Platform", repo: "PLAT", action: "update", title: "Initiative 2", labels: ["product-velocity", "pv:moscow/must"], block: "Pay fast", issueNumber: null, issueUrl: "https://acme.example/browse/PLAT-13", notes: ["Start date not sent: this Jira site's Start date field is not mapped."] })),
  received: ids.map((id, n): ReceiveItem => ({
    ...card(id, n), tracker: "jira", issueNumber: null, issueLabel: `PLAT-${12 + n}`, issueUrl: `https://acme.example/browse/PLAT-${12 + n}`,
    ...(n === 0 ? { readOnly: true, status: "received" as const, received: [{ label: "Build Status", from: "Not started", to: "In progress" }, { label: "Jira status", from: "To Do", to: "In Review" }] }
      : n === 1 ? { status: "conflict" as const, conflicts: [{ field: "description" as const, label: "Description", kind: "both" as const, pv: "Pay fast", github: "Pay quickly (edited in Jira)", ghHash: "h", defaultChoice: null }] }
      : { status: "missing" as const, message: "Jira did not return this issue (deleted, moved or not visible to the connection). Nothing was changed." }),
  })),
});

/** "Removed in Product Velocity" (Jira scenario): R-5 has one Done status, R-6 two (the person chooses; Jira refuses the first close), R-7 none (label only), R-8 cannot be read. */
const REMOVED: RemovedCard[] = [
  { id: "55555555-5555-4555-8555-555555555555", code: "R-5", name: "Old checkout", issueKey: "PLAT-20", issueUrl: "https://acme.example/browse/PLAT-20", state: "ready", jiraStatus: "In Progress", options: [{ id: "31", name: "Done", toStatusName: "Done" }], defaultTransitionId: "31" },
  { id: "66666666-6666-4666-8666-666666666666", code: "R-6", name: "Old loyalty", issueKey: "PLAT-21", issueUrl: "https://acme.example/browse/PLAT-21", state: "ready", jiraStatus: "To Do", options: [{ id: "31", name: "Done", toStatusName: "Done" }, { id: "41", name: "Won't do", toStatusName: "Won't do" }], defaultTransitionId: null },
  { id: "77777777-7777-4777-8777-777777777777", code: "R-7", name: "Old referral", issueKey: "PLAT-22", issueUrl: "https://acme.example/browse/PLAT-22", state: "ready", jiraStatus: "To Do", options: [], defaultTransitionId: null },
  { id: "88888888-8888-4888-8888-888888888888", code: "R-8", name: "Old wallet", issueKey: "PLAT-23", issueUrl: null, state: "error", message: "Jira could not be read just now. Try again in a minute.", options: [], defaultTransitionId: null },
];
function fakeRemoved(scenario: string, onClose: (code: string, transition: string | null) => void): RemovedApi {
  const attempts = new Map<string, number>();
  return {
    list: async () => (scenario === "jira" ? { ok: true, items: REMOVED, more: 0 } : { ok: true, items: [], more: 0 }),
    close: async (id, transition) => {
      const c = REMOVED.find((x) => x.id === id)!;
      onClose(c.code, transition);
      await new Promise((r) => setTimeout(r, 300));
      const tries = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, tries);
      if (c.code === "R-6" && tries === 1) return { ok: true, result: { id, code: c.code, outcome: "error", issueLabel: c.issueKey, message: "The label pv:removed was added, but the issue was not closed. Jira refused it: resolution: Resolution is required" } };
      if (c.code === "R-7") return { ok: true, result: { id, code: c.code, outcome: "labeled", issueLabel: c.issueKey, message: "No transition to a Done status exists in this issue's workflow, so only the label pv:removed was added. Close it in Jira." } };
      return { ok: true, result: { id, code: c.code, outcome: "closed", issueLabel: c.issueKey, issueUrl: c.issueUrl ?? undefined, message: `Moved to ${c.options.find((o) => o.id === transition)?.toStatusName ?? "Done"} and labelled pv:removed.` } };
    },
  };
}

/**
 * Fake server calls for the dialog. Scenarios: `ok` (all three are written), `fail` (R-2 fails the first time and works on Try again),
 * `stale` (GitHub changed for R-2: the dialog returns to the preview), `lost` (the connection drops while R-2 is written).
 */
function fakeApi(scenario: string, onCall: (code: string) => void, removed?: RemovedApi): SyncApi {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const attempts = new Map<string, number>();
  return {
    ...(removed ? { removed } : {}),
    start: async (ids) => scenario === "jira" ? jiraPreview(ids) : { ok: true, account: "acme", received: ids.map((id) => card(id, IDS.indexOf(id))), send: ids.map((id) => plan(id, IDS.indexOf(id))) },
    board: async () => ({ ok: true, lines: {}, failed: false }),
    confirm: async (ids) => {
      const id = ids[0]!;
      const n = IDS.indexOf(id);
      onCall(CODES[n]!);
      await wait(400);
      const tries = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, tries);
      if (scenario === "lost" && n === 1) throw new Error("network");
      if (scenario === "stale" && n === 1 && tries === 1) return { ok: false, error: "GitHub changed after you looked. Nothing was applied or sent for it.", stale: { account: "acme", received: [{ ...card(id, n), message: "Changed in GitHub just now." }], send: [plan(id, n)] } };
      if (scenario === "fail" && n === 1 && tries === 1) return { ok: true, results: [{ id, code: CODES[n]!, outcome: "error", message: "GitHub refused the update (rate limit)." }], taken: [] };
      return { ok: true, results: [{ id, code: CODES[n]!, outcome: "updated", ...(scenario === "jira" ? { issueLabel: "PLAT-13", issueUrl: "https://acme.example/browse/PLAT-13" } : { issueNumber: 100 + n }) }], taken: [] };
    },
  };
}

/**
 * The first step of Sync with in-memory issues: `new=1` has some, `new=0` has none, `new=err` has some and the read of GitHub fails,
 * `new=hang` has some and the read of GitHub never answers; no value leaves the step out.
 */
function fakeNewItems(which: string | undefined, onRefresh: () => void): NewItemsConfig | undefined {
  if (which !== "0" && which !== "1" && which !== "err" && which !== "hang" && which !== "jira" && which !== "jira0") return undefined;
  const jira = which === "jira" || which === "jira0";
  const source = new MemoryIncomingSource(which === "0" || which === "jira0" ? [] : jira ? JIRA_SAMPLE : undefined);
  return {
    tracker: jira ? "jira" : "github", name: jira ? "Jira" : "GitHub", terms: jira ? JIRA_TERMS : GITHUB_TERMS,
    source,
    refresh: async () => { onRefresh(); if (which === "err") throw new Error("GitHub could not be read"); if (which === "hang") await new Promise(() => undefined); },
    count: async () => (await source.load()).issues.filter((i) => i.pullState === "not_pulled").length,
    projects: async () => [{ id: "p1", name: "Platform" }, { id: "p2", name: "Marketplace" }],
    canEdit: true,
    canAdmin: true,
  };
}

/** Jira-shaped issues for the test page: the project key is the group, the number is the key's number. */
const JIRA_SAMPLE: IncomingIssue[] = [
  { id: "j1", repo: "PLAT", number: 12, title: "Checkout redesign", issueType: "Epic", labels: ["payments"], state: "open", parentNumber: null, url: "https://acme.example/browse/PLAT-12", pullState: "not_pulled", ignoreReason: null, itemId: null, updatedAt: "2026-11-01T10:00:00Z" },
  { id: "j2", repo: "PLAT", number: 15, title: "Fix typo on the invoice page", issueType: "Task", labels: [], state: "open", parentNumber: 12, url: "https://acme.example/browse/PLAT-15", pullState: "not_pulled", ignoreReason: null, itemId: null, updatedAt: "2026-10-30T10:00:00Z" },
  { id: "j3", repo: "GROW", number: 4, title: "Referral programme", issueType: "Epic", labels: [], state: "open", parentNumber: null, url: "https://acme.example/browse/GROW-4", pullState: "not_pulled", ignoreReason: null, itemId: null, updatedAt: "2026-10-28T10:00:00Z" },
];

export function SyncHarness({ scenario, newIssues }: { scenario: string; newIssues?: string }) {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState<string[]>([]);
  const [closed, setClosed] = useState<string[]>([]);
  const api = useMemo(() => fakeApi(scenario, (c) => setCalls((prev) => [...prev, c]), scenario === "jira" ? fakeRemoved(scenario, (c, t) => setClosed((prev) => [...prev, `${c}:${t ?? "-"}`])) : undefined), [scenario]);
  const [refreshes, setRefreshes] = useState(0);
  const newItems = useMemo(() => fakeNewItems(newIssues, () => setRefreshes((n) => n + 1)), [newIssues]);
  // stable between renders: a new function each time would restart the dialog's first step whenever a counter below changes
  const trackersOf = useCallback(async () => [newItems?.tracker ?? "github"], [newItems]);
  return (
    <div className="shell"><main className="content">
      <button type="button" className="btn" onClick={() => setOpen(true)}>Open sync</button>
      <output data-testid="calls">{calls.join(",")}</output>
      <output data-testid="refreshes">{refreshes}</output>
      <output data-testid="closed">{closed.join(",")}</output>
      {open && <GithubPushDialog ids={IDS} api={api} newItems={newItems} trackersOf={trackersOf} onClose={() => setOpen(false)} />}
    </main></div>
  );
}
