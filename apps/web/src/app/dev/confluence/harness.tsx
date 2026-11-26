"use client";

import { ConfluenceDialog } from "@/features/portfolio/confluence-dialog";

export function ConfluenceHarness() {
  return <ConfluenceDialog doc={{ id: "d1", title: "GTM one-pager: R89 Bidder", version: 1, aiDraft: false }} onClose={() => {}} onChanged={() => {}} />;
}
