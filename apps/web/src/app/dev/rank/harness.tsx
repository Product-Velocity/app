"use client";
import { useEffect } from "react";
import { SuggestedOrder } from "@/app/(workspace)/alignment/[id]/results/suggested-order";
import type { SuggestionRow } from "@/lib/alignment-rank";

// Fictional initiatives: the team's Stack Rank today (from) and the place the crowd gave (place, with a tie at 2)
const rows: SuggestionRow[] = [
  { itemId: "00000000-0000-4000-8000-000000000001", code: "R-04", name: "Self-serve onboarding", place: 1, tied: false, from: 6 },
  { itemId: "00000000-0000-4000-8000-000000000002", code: "R-11", name: "Bidder dashboard refresh", place: 2, tied: true, from: 2 },
  { itemId: "00000000-0000-4000-8000-000000000003", code: "R-07", name: "Host-read ad scheduling", place: 2, tied: true, from: 9 },
  { itemId: "00000000-0000-4000-8000-000000000004", code: "R-02", name: "Marketplace search relevance", place: 4, tied: false, from: 1 },
  { itemId: "00000000-0000-4000-8000-000000000005", code: "R-15", name: "Payout reconciliation", place: 5, tied: false, from: 12 },
];

export function HarnessRank() {
  useEffect(() => { (window as unknown as { __applied: unknown[] }).__applied = []; }, []);
  // stands in for the server action: records what the form would send
  const apply = async (form: FormData) => {
    const reasons = Object.fromEntries([...form.entries()].filter(([k]) => k.startsWith("reason_")).map(([k, v]) => [k.slice(7), v]));
    (window as unknown as { __applied: unknown[] }).__applied.push({ session: form.get("session"), items: form.getAll("item"), order: form.getAll("order"), reasons, seen: form.get("seen") });
  };
  return (
    <div className="page-wide">
      <h1>Alignment results (test page)</h1>
      <h2>Order for the Stack Rank</h2>
      <SuggestedOrder sessionId="11111111-1111-4111-8111-111111111111" rows={rows} skipped={1} apply={apply} />
    </div>
  );
}
