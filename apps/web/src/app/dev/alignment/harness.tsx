"use client";
import { useEffect } from "react";
import { AlignmentList } from "@/features/alignment/alignment-list";
import type { Initiative } from "@/lib/alignment-pick";
import type { SessionRow } from "@/lib/alignment-list";

// Fictional sessions. "Now" is fixed so the chips do not depend on the day the test runs: Wed 10 Mar 2027, 12:00 UTC.
const NOW = new Date("2027-03-10T12:00:00Z");
const ADMIN = "00000000-0000-4000-8000-0000000000a1", OTHER = "00000000-0000-4000-8000-0000000000a2";
const people = { [ADMIN]: "ana@example.test", [OTHER]: "bo@example.test" };
const stats = (invited: number, voted: number, over: Partial<NonNullable<SessionRow["stats"]>> = {}) => ({ invited, voted, mailingDraft: false, applied: null, undone: false, ...over });

const ALL: SessionRow[] = [
  { id: "s-q1", name: "Q1 priorities", method: "coins", status: "closed", createdAt: "2027-01-12T09:00:00Z", openedAt: "2027-01-20T09:00:00Z", closesAt: "2027-02-10T17:00:00Z", closedAt: "2027-02-10T17:00:00Z", createdBy: ADMIN,
    initiatives: 8, itemNames: "Self-serve onboarding, Bidder dashboard refresh, Payout reconciliation", quarter: "Q1 2027", quarters: ["Q1 2027"], contested: 2, stats: stats(14, 11, { applied: { at: "2027-02-12T10:00:00Z", moved: 3 } }) },
  { id: "s-vote", name: "Roadmap vote", method: "ice", status: "open", createdAt: "2027-02-20T09:00:00Z", openedAt: "2027-03-01T09:00:00Z", closesAt: "2027-03-11T15:00:00Z", closedAt: null, createdBy: OTHER,
    initiatives: 6, itemNames: "Host-read ad scheduling, Marketplace search relevance", quarter: "Q2 2027", quarters: ["Q2 2027", "Q3 2027"], contested: null, stats: stats(9, 4, { mailingDraft: true }) },
  { id: "s-mobile", name: "Mobile bets", method: "top5_duels", status: "draft", createdAt: "2027-03-05T09:00:00Z", openedAt: null, closesAt: null, closedAt: null, createdBy: ADMIN,
    initiatives: 5, itemNames: "Push notifications, Offline mode", quarter: null, quarters: [], contested: null, stats: stats(0, 0) },
  { id: "s-q4", name: "Q4 planning", method: "top5_duels", status: "closed", createdAt: "2026-09-15T09:00:00Z", openedAt: "2026-09-20T09:00:00Z", closesAt: "2026-10-02T17:00:00Z", closedAt: "2026-10-02T17:00:00Z", createdBy: OTHER,
    initiatives: 5, itemNames: "Subscription tiers, Self-serve onboarding", quarter: "Q4 2026", quarters: ["Q4 2026"], contested: 1, stats: stats(10, 9) },
  { id: "s-old", name: "Old vote", method: "coins", status: "archived", createdAt: "2026-05-01T09:00:00Z", openedAt: "2026-05-05T09:00:00Z", closesAt: "2026-06-01T17:00:00Z", closedAt: "2026-06-01T17:00:00Z", createdBy: ADMIN,
    initiatives: 4, itemNames: "Legacy export", quarter: "Q2 2026", quarters: ["Q2 2026"], contested: 0, stats: stats(6, 5, { applied: { at: "2026-06-03T10:00:00Z", moved: 2 } }) },
];
/** What a member gets from the database: closed or archived sessions that allow results, without the admin-only values. */
const MEMBER: SessionRow[] = ALL.filter((r) => r.id === "s-q1" || r.id === "s-q4" || r.id === "s-old").map((r) => ({ ...r, stats: null, createdBy: null }));

const initiatives: Initiative[] = [
  { id: "i1", code: "R-04", name: "Self-serve onboarding", project: "Growth", phase: "Discover", moscow: "Must", quarter: "Q1 2027", ready: false },
  { id: "i2", code: "R-11", name: "Bidder dashboard refresh", project: "Marketplace", phase: "Define", moscow: "Must", quarter: "Q1 2027", ready: false },
  { id: "i3", code: "R-07", name: "Host-read ad scheduling", project: "Marketplace", phase: "Build", moscow: "Must", quarter: "Q1 2027", ready: true },
  { id: "i4", code: "R-02", name: "Marketplace search relevance", project: "Marketplace", phase: "Discover", moscow: "Should", quarter: "Q2 2027", ready: false },
  { id: "i5", code: "R-15", name: "Payout reconciliation", project: "Payments", phase: "Define", moscow: "Could", quarter: "Q1 2027", ready: false },
  { id: "i6", code: "R-21", name: "Push notifications", project: "Mobile", phase: "Test", moscow: null, quarter: null, ready: false },
];

export function HarnessAlignment({ role, empty }: { role: "admin" | "member"; empty: boolean }) {
  useEffect(() => { (window as unknown as { __created: unknown[] }).__created = []; }, []);
  const create = async (ids: string[], name: string, method: string) => {
    (window as unknown as { __created: unknown[] }).__created.push({ ids, name, method });
    return { ok: true as const, id: "new-session" };
  };
  const rows = empty ? [] : role === "admin" ? ALL : MEMBER;
  return (
    <div className="shell">
      <main className="content">
        <AlignmentList rows={rows} isAdmin={role === "admin"} people={role === "admin" ? people : {}} initiatives={role === "admin" ? initiatives : []} create={create} now={NOW}
          onCreated={(id) => { (window as unknown as { __created: unknown[] }).__created.push({ opened: id }); }} />
      </main>
    </div>
  );
}
