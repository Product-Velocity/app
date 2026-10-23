"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** Reads the page again so a change that just arrived from GitHub shows up without leaving the page. */
export function RefreshButton({ label = "Refresh" }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [at, setAt] = useState<Date | null>(null);
  return (
    <span className="row-form">
      <button type="button" className="btn" disabled={pending} onClick={() => start(() => { router.refresh(); setAt(new Date()); })}>
        {pending ? "Refreshing…" : label}
      </button>
      {at && <span role="status" className="muted">Updated {at.toLocaleTimeString()}</span>}
    </span>
  );
}
