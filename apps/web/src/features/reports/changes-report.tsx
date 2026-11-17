"use client";

import { useEffect, useMemo, useState } from "react";
import { CHANGE_PERIODS, CHANGE_TYPES, changeCounts, changePeriod, changeReport, changeTypeLabel, type ChangePeriod, type ChangeType, type FeedRow, type ItemInfo } from "@pv/domain";
import type { ReportEnv } from "./report-env";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/**
 * Changes: which initiatives changed in a period and what changed, grouped by initiative (issue #472). Follows the filters of the Reports tab.
 * Each change shows the time Product Velocity registered it, the source and who made it. Actors are named on a row; nothing is counted per person (rule 8).
 */
export function ChangesReport({ env, load, onOpen }: { env: ReportEnv; load?: (from: Date, to: Date) => Promise<FeedRow[]>; onOpen: (id: string) => void }) {
  const { rows, lookups } = env;
  const [period, setPeriod] = useState<ChangePeriod>("today");
  const [types, setTypes] = useState<ChangeType[]>([]);
  const [loaded, setLoaded] = useState<{ key: string; rows: FeedRow[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    if (!load) return;
    const { from, to } = changePeriod(period, new Date());
    load(from, to).then((r) => { if (live) { setLoaded({ key: `${period}:${reload}`, rows: r }); setFailed(null); } }, (e: unknown) => { if (live) setFailed(e instanceof Error ? e.message : "Could not read the changes."); });
    return () => { live = false; };
  }, [load, period, reload]);

  const feed = loaded && loaded.key === `${period}:${reload}` ? loaded.rows : null; // null while a new period is loading
  const items = useMemo(() => new Map<string, ItemInfo>(rows.map((r) => [r.id, { code: String(r.item_code ?? ""), name: String(r.initiative_name ?? ""), rank: r.stack_rank }])), [rows]);
  const counts = useMemo(() => changeCounts(feed ?? [], items), [feed, items]);
  const groups = useMemo(() => changeReport(feed ?? [], items, types), [feed, items, types]);
  const who = (id: string | null) => (id ? lookups.members.find((m) => m.user_id === id)?.email ?? "someone" : "the system");
  const toggle = (t: ChangeType) => setTypes((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const { from, to } = changePeriod(period, new Date());
  const range = `${from.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to ${new Date(to.getTime() - 1).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

  if (failed) return <div role="alert" className="error">Could not load the changes: {failed} <button type="button" className="link-button" onClick={() => setReload((n) => n + 1)}>Try again</button></div>;

  return (
    <section className="rp-card rp-wide" aria-label="Changes">
      <h2 className="rp-title">Changes</h2>
      <p className="rp-note">What changed on the initiatives that match the filters above, {range}. Times are when Product Velocity registered the change, in your time zone. Linked issues are the GitHub or Jira issues of an initiative; a closed issue sets Build Status, never the initiative&apos;s own status.</p>
      <div className="view-chips" role="group" aria-label="Period">
        {CHANGE_PERIODS.map((p) => <button key={p.id} type="button" className={period === p.id ? "view-chip view-chip-on" : "view-chip"} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>)}
      </div>
      <div className="view-chips" role="group" aria-label="Change type">
        {CHANGE_TYPES.map((t) => <button key={t.id} type="button" title={t.hint} className={types.includes(t.id) ? "view-chip view-chip-on" : "view-chip"} aria-pressed={types.includes(t.id)} onClick={() => toggle(t.id)}>{t.label} ({counts[t.id]})</button>)}
        {types.length > 0 && <button type="button" className="link-button" onClick={() => setTypes([])}>Clear</button>}
      </div>

      {!load ? <p role="status" className="muted">The changes are not available here.</p>
        : feed === null ? <p role="status" className="muted">Loading the changes…</p>
        : groups.length === 0 ? <p className="rp-empty" role="status">No changes in this period for the current filters</p>
        : (
          <>
            <p className="muted" role="status">{plural(groups.length, "initiative", "initiatives")} changed{feed.length >= 5000 ? " (showing the latest 5,000 changes)" : ""}.</p>
            <ol className="ip-log" aria-label="Changed initiatives">
              {groups.map((g) => (
                <li key={g.itemId}>
                  <p>
                    <button type="button" className="link-button" onClick={() => onOpen(g.itemId)}><strong>{g.code}</strong> {g.name}</button>{" "}
                    {g.moved.length > 0
                      ? <span className="pill" title="The initiative itself changed">Initiative: {g.moved.map(changeTypeLabel).join(", ")}</span>
                      : <span className="pill" title="Only the linked issues changed">Initiative unchanged</span>}
                    {g.trackerChanges > 0 && <> <span className="pill">{plural(g.trackerChanges, "linked-issue change", "linked-issue changes")}</span></>}
                  </p>
                  <ul>
                    {g.entries.map((e) => (
                      <li key={e.id}>
                        <strong>{changeTypeLabel(e.type)}{e.tracker ? ` (${e.tracker})` : ""}</strong>: {e.from ?? "empty"} → {e.to ?? "empty"}
                        <span className="muted"> · <time dateTime={e.at}>{when(e.at)}</time> · {who(e.actorId)} · {e.via}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </>
        )}
    </section>
  );
}
