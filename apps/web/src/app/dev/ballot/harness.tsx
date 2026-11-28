"use client";

import "@/app/a/[token]/voter.css";
import { VoterShell } from "@/app/a/[token]/voter-shell";
import { voterBrandFor } from "@/lib/brand/voter-brand";
import { useEffect, useMemo } from "react";
import { Ballot, type BallotApi } from "@/app/a/[token]/ballot";
import type { BallotItem, Method } from "@/lib/alignment-ballot";

/** The ballot with an in-memory server: window.__ballot records every save and submit, and `fail` makes the next submit fail once. */
export function BallotHarness({ method, n, brand }: { method: string; n: number; brand?: { color: string; name: string; logo: boolean } }) {
  // a company brand for the test page: the same rule the real pages use (issue #750); the logo is a stand-in picture
  const view = brand ? voterBrandFor({ status: "confirmed", use_on_voting: true, display_name: brand.name, primary_color: brand.color.startsWith("#") ? brand.color : `#${brand.color}`, accent_color: null, logo_path: brand.logo ? "x" : null, public_token: "a".repeat(32) }, "Acme", true) : null;
  const items = useMemo<BallotItem[]>(() => Array.from({ length: n }, (_, i) => ({ id: `item-${i + 1}`, name: `Initiative ${i + 1}`, summary: `Summary of initiative ${i + 1}`, value: i % 2 ? "Why it matters" : null, more: i === 0 ? [{ label: "Business Line", value: "Direct" }, { label: "Business Value (12 months)", value: "€250,000" }, { label: "Effort", value: "M" }] : undefined })), [n]);
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
    <VoterShell title="Q1 priorities" brand={view ? { name: view.name, logoSrc: view.logoPath ? "/brand/icon-192.png" : null, vars: view.vars } : null}>
        <Ballot api={api} token="test" method={method as Method} items={items} coinsTotal={100} coinsMax={30} initial={{}} initialRevision={0} submitted={false} closesAt="2026-12-01T17:00:00Z" />
    </VoterShell>
  );
}
