"use client";

import { useEffect, useMemo } from "react";
import { Ballot, type BallotApi } from "@/app/a/[token]/ballot";
import type { BallotItem, Method } from "@/lib/alignment-ballot";

/** The ballot with an in-memory server: window.__ballot records every save and submit, and `fail` makes the next submit fail once. */
export function BallotHarness({ method, n }: { method: string; n: number }) {
  const items = useMemo<BallotItem[]>(() => Array.from({ length: n }, (_, i) => ({ id: `item-${i + 1}`, name: `Initiative ${i + 1}`, summary: `Summary of initiative ${i + 1}`, value: i % 2 ? "Why it matters" : null })), [n]);
  const api = useMemo<BallotApi>(() => {
    type Store = { saves: unknown[]; submits: unknown[]; failNext: boolean; stored: number };
    const store = () => (window as unknown as { __ballot: Store }).__ballot;
    return {
      save: async (_t, progress, revision) => { const b = store(); if (revision > b.stored) { b.stored = revision; b.saves.push({ progress, revision }); } return { ok: true, revision: b.stored }; },
      submit: async (_t, answers, revision) => {
        const b = store();
        if (b.failNext) { b.failNext = false; return { ok: false, error: "We could not reach the server. Check your connection and press the button again." }; }
        b.submits.push({ answers, revision });
        return { ok: true };
      },
    };
  }, []);
  useEffect(() => { (window as unknown as { __ballot: unknown }).__ballot = { saves: [], submits: [], failNext: false, stored: 0 }; }, []);
  return (
    <main className="auth-page">
      <div className="card auth-card stack ballot-shell">
        <h1>Q1 priorities</h1>
        <Ballot api={api} token="test" method={method as Method} items={items} coinsTotal={100} coinsMax={30} initial={{}} initialRevision={0} submitted={false} closesAt="2026-12-01T17:00:00Z" />
      </div>
    </main>
  );
}
