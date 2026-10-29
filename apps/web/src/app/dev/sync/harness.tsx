"use client";

import { useMemo, useState } from "react";
import { GithubPushDialog } from "@/features/portfolio/github-push-dialog";
import { MemoryIncomingSource } from "@/features/incoming/memory-source";
import type { NewItemsConfig } from "@/features/portfolio/new-items";
import type { SyncApi } from "@/lib/tracker/sync-router";
import type { PlanItem, ReceiveItem } from "@/lib/github/push-types";

const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const CODES = ["R-1", "R-2", "R-3"];
const card = (id: string, n: number): ReceiveItem => ({ id, code: CODES[n]!, name: `Initiative ${n + 1}`, status: "in_step", received: [], issueNumber: 100 + n, issueUrl: null });
const plan = (id: string, n: number): PlanItem => ({ id, code: CODES[n]!, name: `Initiative ${n + 1}`, project: "Platform", repo: "acme/app", action: "update", title: `${CODES[n]}: Initiative ${n + 1}`, labels: [], block: "", issueNumber: 100 + n, issueUrl: null });

/**
 * Fake server calls for the dialog. Scenarios: `ok` (all three are written), `fail` (R-2 fails the first time and works on Try again),
 * `stale` (GitHub changed for R-2: the dialog returns to the preview), `lost` (the connection drops while R-2 is written).
 */
function fakeApi(scenario: string, onCall: (code: string) => void): SyncApi {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const attempts = new Map<string, number>();
  return {
    start: async (ids) => ({ ok: true, account: "acme", received: ids.map((id) => card(id, IDS.indexOf(id))), send: ids.map((id) => plan(id, IDS.indexOf(id))) }),
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
      return { ok: true, results: [{ id, code: CODES[n]!, outcome: "updated", issueNumber: 100 + n }], taken: [] };
    },
  };
}

/** The first step of Sync with in-memory issues: `new=1` has some, `new=0` has none, no value leaves the step out. */
function fakeNewItems(which: string | undefined): NewItemsConfig | undefined {
  if (which !== "0" && which !== "1") return undefined;
  const source = new MemoryIncomingSource(which === "0" ? [] : undefined);
  return {
    source,
    count: async () => (await source.load()).issues.filter((i) => i.pullState === "not_pulled").length,
    projects: async () => [{ id: "p1", name: "Platform" }, { id: "p2", name: "Marketplace" }],
    canEdit: true,
    canAdmin: true,
  };
}

export function SyncHarness({ scenario, newIssues }: { scenario: string; newIssues?: string }) {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState<string[]>([]);
  const api = useMemo(() => fakeApi(scenario, (c) => setCalls((prev) => [...prev, c])), [scenario]);
  const newItems = useMemo(() => fakeNewItems(newIssues), [newIssues]);
  return (
    <div className="shell"><main className="content">
      <button type="button" className="btn" onClick={() => setOpen(true)}>Open sync</button>
      <output data-testid="calls">{calls.join(",")}</output>
      {open && <GithubPushDialog ids={IDS} api={api} newItems={newItems} onClose={() => setOpen(false)} />}
    </main></div>
  );
}
