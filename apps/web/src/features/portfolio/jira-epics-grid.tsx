"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PortfolioController } from "./controller";
import { useStatus } from "./status-strip";
import type { JiraEpicRequestRow, JiraTreeRow } from "./types";
import { MAX_EPIC_KEYS, parseEpicKeys } from "@/lib/atlassian/epic-keys";
import {
  NOT_READ, NO_FILTER, buildEpicRows, checkSummary, checkable, distinct, filterEpicRows, linksText, removable, resultText, statusOf, targetRows, typeOf,
  type CheckResult, type EpicFilter,
} from "./jira-epics-model";

const CATEGORY = { new: "to do", indeterminate: "in progress", done: "done" } as const;

/**
 * The Jira epics of an initiative, as one grid (issue #431, #656): the epics a person listed with what Jira last reported about each and its children.
 * On top: add keys, filter by type and status. Check, Copy links and Remove work on the selected rows, or on every row shown when none is selected,
 * and each epic row has its own Check and Remove. Nothing is written to Jira here: Sync with Jira links (or, in a read only project, reads) the epics.
 */
export function JiraEpicsGrid({ controller, itemId, readOnly = false, tree, treeError, total, closed }: {
  controller: PortfolioController; itemId: string;
  /** The project is read only for Jira (issue #656): the keys are read, never written. */
  readOnly?: boolean;
  /** What the last read found: the epics and their children (null while loading). */
  tree: JiraTreeRow[] | null; treeError?: string | null;
  /** Delivery progress of the initiative (read only projects), counted at the lowest level. */
  total?: number | null; closed?: number;
}) {
  useStatus(controller);
  const [requests, setRequests] = useState<JiraEpicRequestRow[] | null>(null);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Record<string, CheckResult>>({});
  const [filter, setFilter] = useState<EpicFilter>(NO_FILTER);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const load = useCallback(() => controller.jiraEpicRequests(itemId).then(setRequests, () => setRequests([])), [controller, itemId]);
  useEffect(() => { void load(); }, [load, controller.status.version]);

  const all = useMemo(() => buildEpicRows(requests ?? [], tree ?? [], checks), [requests, tree, checks]);
  const shown = useMemo(() => filterEpicRows(all, filter), [all, filter]);
  const targets = useMemo(() => targetRows(shown, selected), [shown, selected]);
  const nSelected = shown.filter((r) => selected.has(r.key)).length;
  const filtered = filter.type !== "" || filter.status !== "" || filter.text.trim() !== "";
  const scope = nSelected > 0 ? "selected" : filtered ? "shown" : "all";
  const epics = all.filter((r) => r.kind === "epic");
  const children = all.length - epics.length;
  const toCheck = targets.filter(checkable);
  const toRemove = shown.filter((r) => selected.has(r.key) && removable(r));
  const canEdit = controller.canEdit;

  const headRef = useRef<HTMLInputElement>(null);
  const allShownSelected = shown.length > 0 && nSelected === shown.length;
  useEffect(() => { if (headRef.current) headRef.current.indeterminate = nSelected > 0 && !allShownSelected; }, [nSelected, allShownSelected]);

  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(shown.map((r) => r.key)));

  /** Asks Jira about these epics (read only) and keeps the answers beside the ones already known. */
  const check = async (keys: string[]): Promise<string | null> => {
    if (keys.length === 0) return null;
    const r = await controller.checkJiraEpics(itemId, keys);
    if (!r.ok) return r.error;
    setChecks((prev) => ({ ...prev, ...Object.fromEntries(r.lines.map((l) => [l.key, { ok: l.ok, text: l.text }])) }));
    return checkSummary(r.lines, readOnly);
  };
  const runCheck = async (keys: string[]) => {
    if (keys.length === 0) { setMessage("Nothing to check: linked epics are already in Jira."); return; }
    setBusy(true);
    const said = await check(keys);
    setBusy(false);
    setMessage(said);
  };

  const parsed = parseEpicKeys(text);
  const add = async () => {
    if (parsed.invalid.length > 0) { setMessage(`These are not Jira issue keys: ${parsed.invalid.join(", ")}.`); return; }
    if (parsed.keys.length === 0 || parsed.keys.length > MAX_EPIC_KEYS) { setMessage(`Enter between 1 and ${MAX_EPIC_KEYS} epic keys.`); return; }
    setBusy(true);
    const r = await controller.requestJiraEpics(itemId, parsed.keys);
    if (!r.ok) { setBusy(false); setMessage(r.error); return; }
    setText("");
    await load();
    // entering the keys checks them straight away (read only); nothing is written to Jira until Sync with Jira is confirmed
    const said = await check(r.added);
    setBusy(false);
    setMessage(said ?? "Those epics were already on the list.");
  };

  const remove = async (keys: string[]) => {
    if (keys.length === 0) return;
    setBusy(true);
    let failed: string | null = null;
    for (const k of keys) { const r = await controller.removeJiraEpicRequest(itemId, k); if (!r.ok) { failed = r.error; break; } }
    setBusy(false);
    setSelected((s) => { const n = new Set(s); for (const k of keys) n.delete(k); return n; });
    setChecks((prev) => { const n = { ...prev }; for (const k of keys) delete n[k]; return n; });
    setMessage(failed ?? (keys.length === 1 ? `${keys[0]} taken off the list.` : `${keys.length} epics taken off the list.`));
    await load();
  };

  const copy = async (rows: typeof all) => {
    if (rows.length === 0) { setMessage("Nothing to copy."); return; }
    const { text: out, withoutLink } = linksText(rows);
    try {
      await navigator.clipboard.writeText(out);
      setMessage(`${rows.length === 1 ? "1 link" : `${rows.length} links`} copied.${withoutLink.length > 0 ? ` No link is known yet for ${withoutLink.join(", ")} (copied as the key): press Sync with Jira to read it.` : ""}`);
    } catch {
      setMessage("The browser did not allow copying. Select the rows and use Ctrl+C on the links in Jira instead.");
    }
  };

  const types = distinct(all, typeOf);
  const statuses = distinct(all, statusOf);
  const listed = requests?.length ?? 0;

  return (
    <section className="eg" aria-label="Jira epics of this initiative">
      <h4>Jira epics{listed > 0 ? ` (${listed} listed)` : ""}</h4>
      <details className="eg-help">
        <summary>How this works</summary>
        {readOnly
          ? <p className="muted">This project is read only for Jira: nothing is ever written to Jira. Enter the keys of the Jira epics that deliver this initiative, from any Jira project. Product Velocity checks them with Jira (they must exist and be epics). Sync with Jira and the daily check then read them with their children, and their status and delivery progress roll up here. A closed epic never completes the initiative.</p>
          : <p className="muted">Already know which Jira epics belong under this initiative? Enter their keys, from any Jira project. Product Velocity checks them with Jira (they must exist and be epics). Then Sync with Jira shows each one; after you confirm, it creates the Jira Initiative if it does not exist yet and sets each epic&apos;s parent to it. Nothing else about the epic is changed, and nothing is written to Jira until you confirm. This needs the project&apos;s initiative type to be a level above Epic (Jira page).</p>}
      </details>

      {canEdit && (
        <form className="eg-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <label className="eg-add-field">
            <span className="visually-hidden">Epic keys to add</span>
            <textarea
              rows={1} value={text} placeholder="Add: R8P-5, DATA-9 or links to the epics" disabled={busy}
              onChange={(e) => { setText(e.target.value); setMessage(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void add(); } }}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || text.trim() === ""}>Add and check</button>
        </form>
      )}
      <p role="status" className={message ? "notice" : "visually-hidden"}>{message}</p>

      {treeError && <p role="alert" className="pf-error">Could not load the issues: {treeError}</p>}
      {!treeError && tree && tree.length > 0 && (
        <p>
          <strong>{epics.length} {epics.length === 1 ? "epic" : "epics"}</strong> · <strong>{children} child {children === 1 ? "issue" : "issues"}</strong>
          {total != null ? <> · <strong>{closed ?? 0} of {total}</strong> done (counted at the lowest level; a done issue means the build is progressing, not that the initiative is complete)</> : null}
        </p>
      )}

      <div className="eg-bar" role="toolbar" aria-label="Filter and act on the epics">
        <label>Type
          <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Status
          <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">All statuses</option>
            {statuses.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Search
          <input type="search" value={filter.text} placeholder="Key, title or assignee" onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
        </label>
        {filtered && <button type="button" className="btn" onClick={() => setFilter(NO_FILTER)}>Clear filters</button>}
      </div>
      <div className="eg-bar" role="toolbar" aria-label="Actions on the rows">
        <span className="muted" aria-live="polite">{nSelected > 0 ? `${nSelected} selected` : `${shown.length} ${shown.length === 1 ? "row" : "rows"}${filtered ? ` of ${all.length}` : ""}`}</span>
        {canEdit && <button type="button" className="btn" disabled={busy || toCheck.length === 0} onClick={() => void runCheck(toCheck.map((r) => r.key))}>Check {scope} ({toCheck.length})</button>}
        <button type="button" className="btn" disabled={targets.length === 0} onClick={() => void copy(targets)}>Copy {scope} {targets.length === 1 ? "link" : "links"} ({targets.length})</button>
        {canEdit && <button type="button" className="btn" disabled={busy || toRemove.length === 0} onClick={() => void remove(toRemove.map((r) => r.key))}>Remove selected ({toRemove.length})</button>}
      </div>

      {requests === null && <p role="status" className="muted">Loading the list…</p>}
      {requests !== null && all.length === 0 && <p className="muted">No epics listed yet.{canEdit ? " Add the keys above." : ""}</p>}
      {all.length > 0 && (
        <div className="ip-scroll eg-scroll" role="region" aria-label="Epics and their children" tabIndex={0}>
          <table className="table ip-gh eg-table" aria-label="Jira epics and their children">
            <thead>
              <tr>
                <th scope="col" className="eg-sel"><input ref={headRef} type="checkbox" aria-label="Select all rows shown" checked={allShownSelected} disabled={shown.length === 0} onChange={toggleAll} /></th>
                {["Issue", "Title", "Type", "Status", "Assignee", "Check", "Actions"].map((h) => <th key={h} scope="col">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={8} className="muted">No row matches the filters.</td></tr>}
              {shown.map((r) => {
                const res = r.kind === "epic" ? resultText(r, readOnly) : null;
                return (
                  <tr key={`${r.kind}-${r.key}`} className={r.kind === "child" ? "ip-gh-task" : "ip-gh-epic"} aria-selected={selected.has(r.key)}>
                    <td className="eg-sel"><input type="checkbox" aria-label={`Select ${r.key}`} checked={selected.has(r.key)} onChange={() => toggle(r.key)} /></td>
                    <td className="mono">{r.kind === "child" ? "↳ " : ""}{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.key}</a> : r.key}</td>
                    <td>{r.title ?? <span className="muted">—</span>}</td>
                    <td>{r.type ?? <span className="muted">{NOT_READ}</span>}</td>
                    <td>{r.status ?? <span className="muted">—</span>}{r.category ? <> <span className="muted">({CATEGORY[r.category]})</span></> : null}</td>
                    <td>{r.kind === "child" || r.status ? (r.assignee ?? <span className="muted">Unassigned</span>) : <span className="muted">—</span>}</td>
                    <td>{res ? <><strong>{res.label}</strong>{res.detail ? <>: <span className={res.tone === "bad" ? "pf-error" : undefined}>{res.detail}</span></> : null}</> : <span className="muted">—</span>}</td>
                    <td className="eg-actions">
                      {canEdit && checkable(r) && <button type="button" className="btn" disabled={busy} aria-label={`Check ${r.key}`} onClick={() => void runCheck([r.key])}>Check</button>}
                      <button type="button" className="btn" aria-label={`Copy the link of ${r.key}`} onClick={() => void copy([r])}>Copy link</button>
                      {canEdit && removable(r) && <button type="button" className="btn" disabled={busy} aria-label={`Take ${r.key} off the list`} onClick={() => void remove([r.key])}>Remove</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {readOnly && <p className="muted">Read only: change issues in Jira. This list is read when you press Sync with Jira, and every day.</p>}
    </section>
  );
}
