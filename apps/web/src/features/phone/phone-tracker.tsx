"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PortfolioController } from "../portfolio/controller";
import { useWorkspaceController } from "../portfolio/portfolio-client";
import type { Lookups } from "../portfolio/types";
import { ago, trackerChanges } from "./phone-changes";
import { usePhoneChanges, type ChangeSource } from "./use-phone-changes";

export function PhoneTrackerClient({ tenantId, role, userId, lookups }: { tenantId: string; role: string; userId: string; lookups: Lookups }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups, userId);
  if (state.kind === "loading") return <><h1>Tracker</h1><p role="status" className="muted">Loading…</p></>;
  if (state.kind === "error") return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  return <PhoneTracker controller={state.controller} tenantId={tenantId} />;
}

/** The ten latest changes from the tracker, with a search for a tracker item (issue key or title, initiative, status). */
export function PhoneTracker({ controller, tenantId, changeSource }: { controller: PortfolioController; tenantId: string; changeSource?: ChangeSource }) {
  const [query, setQuery] = useState("");
  const { rows, loading, error } = usePhoneChanges(controller, tenantId, changeSource);
  const shown = useMemo(() => trackerChanges(rows, query), [rows, query]);
  const now = new Date();
  return (
    <div className="phone-list">
      <div className="phone-sticky">
        <h1 className="phone-title">Tracker</h1>
        <label className="visually-hidden" htmlFor="tracker-search">Search tracker items</label>
        <input id="tracker-search" type="search" className="phone-search" placeholder="Search issue, initiative or status…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <p className="muted phone-count" role="status">{loading ? "Loading…" : query ? `${shown.length} of the latest ${shown.length === 1 ? "match" : "matches"}` : `Latest ${shown.length} from GitHub and Jira`}</p>
      </div>
      {error && <p role="alert" className="pf-error">Could not load tracker changes: {error}</p>}
      {!loading && !error && shown.length === 0 && <p className="notice-box">{query ? "No tracker change matches. Only the last 30 days are searched." : "No tracker changes in the last 30 days. Link initiatives to GitHub or Jira and changes show up here."}</p>}
      <ul className="phone-cards">
        {shown.map((c) => (
          <li key={c.id}>
            <Link className="phone-card" href={`/w/${tenantId}/portfolio/${encodeURIComponent(c.code)}`}>
              <span className="phone-card-top"><span className="mono">{c.issue?.key ?? c.code}</span><span className="muted">{c.source} · {ago(c.at, now)}</span></span>
              <span className="phone-card-name">{c.issue?.title ?? c.name}</span>
              <span className={`phone-change phone-change-${c.tone}`}>{c.type === "build-status" ? "Build status" : "Issue status"}: {c.from ? `${c.from} → ${c.to ?? "empty"}` : c.to}{c.alsoBuild ? ` · Build status: ${c.alsoBuild.from ?? "none"} → ${c.alsoBuild.to ?? "empty"}` : ""}</span>
              <span className="muted phone-card-meta">{c.code} · {c.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
