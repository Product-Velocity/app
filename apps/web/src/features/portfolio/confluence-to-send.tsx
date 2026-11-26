"use client";

import { useEffect, useRef, useState } from "react";
import { StatusPill } from "../../components/status-pill";
import type { Tone } from "../../components/status-tone";

type ToSend = { id: string; itemId: string; code: string; itemName: string; title: string; version: number; publishedVersion: number; pageTitle: string; pageUrl: string; spaceKey: string; direction: "from_confluence" | "to_confluence" | "both"; state: "send" | "receive" | "conflict" | "gone"; pageVersion: number | "missing" | null };
type Refresh = { action: "unchanged" | "update" | "gone"; why: string; localEdits: boolean; excerpt: string; truncated: boolean; lost: string[]; notes: string[]; confirm: string };
type Warning = { kind: string; what: string };
type Preview = { action: "create" | "update" | "none" | "conflict" | "gone"; why: string; title: string; warnings: Warning[]; notes: string[]; confirm: string };
type Row = { preview?: Preview; refresh?: Refresh; loading?: boolean; busy?: boolean; error?: string; done?: string };

const WARNING_WORD: Record<string, string> = { customer: "A customer", key_result: "A key result", value: "The business value", money: "An amount of money" };
const PREVIEW_AT_ONCE = 3;

/** The word and colour of a row's pill. */
const pillOf = (d: ToSend, done: boolean): { word: string; tone: Tone } =>
  done ? { word: "Updated", tone: "good" }
    : d.state === "receive" ? { word: "To receive", tone: "info" }
    : d.state === "conflict" ? { word: "Conflict", tone: "bad" }
    : d.state === "gone" ? { word: "Page gone", tone: "bad" }
    : { word: "To send", tone: "info" };

/** What can be applied for a row once its preview is in: the update itself, never a conflict, a missing page or a document that was also edited here. */
const canApply = (d: ToSend, r: Row): boolean =>
  d.state === "send" ? r.preview?.action === "update"
    : d.state === "receive" ? r.refresh?.action === "update" && !r.refresh.localEdits
    : false;

/** Ticked from the start only when nothing needs a second look: a text that may be commercial is ticked by the person, not for them. */
const tickedAtFirst = (d: ToSend, r: Row): boolean => canApply(d, r) && (d.state === "receive" || (r.preview?.warnings.length ?? 0) === 0);

const sideOf = (d: ToSend): string => (d.direction === "both" ? "both ways" : d.direction === "from_confluence" ? "read from Confluence" : "written to Confluence");
const whyOf = (d: ToSend): string =>
  d.state === "send" ? `The page holds version ${d.publishedVersion}; the document is at version ${d.version}.`
    : d.state === "receive" ? `The page is at version ${d.pageVersion}, newer than the document’s last update from it.`
    : d.state === "conflict" ? `The document is at version ${d.version} (page written from ${d.publishedVersion}) and the page is at version ${d.pageVersion}.`
    : "The page was deleted or can no longer be seen.";

/**
 * Confluence in the Sync dialog (issue #693, #714), laid out like the Jira updates: a list, each row with a checkbox, its preview loaded on its own, and one button
 * that applies the ticked ones. Documents kept up to date with a Confluence page that need something: to SEND (the document is newer than the page), to RECEIVE (the
 * page is newer than the document, for a link that reads or goes both ways) or a CONFLICT (both changed). A preview shows what would be written (and warns about
 * commercial text); applying a row uses the token of its own preview. Nothing is written by the dialog's own "Apply and send": Confluence has its own confirmation.
 * A page changed in Confluence meanwhile (a conflict) or deleted is left to the document's menu, where the person can choose what to do.
 */
export function ConfluenceToSend({ itemIds, show, onSent, onCount }: { itemIds: string[]; /** false while the filter hides it (the list is still loaded). */ show: boolean; onSent?: () => void; /** How many pages still wait, for the counter of the filters. */ onCount?: (open: number) => void }) {
  const [docs, setDocs] = useState<ToSend[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  const asked = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    if (itemIds.length === 0 || itemIds.length > 200) return;
    void fetch(`/api/confluence/to-send?items=${itemIds.map(encodeURIComponent).join(",")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { available?: boolean; documents?: ToSend[] } | null) => { if (live && j?.available && j.documents) setDocs(j.documents); })
      .catch(() => { /* the tracker part of the sync works without it */ });
    return () => { live = false; };
  }, [itemIds]);

  const set = (id: string, patch: Row) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const call = async (id: string, body: Record<string, unknown>) => {
    try {
      const r = await fetch(`/api/documents/${id}/confluence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "sync", ...body }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; preview?: Preview; refresh?: Refresh; done?: { message: string } };
      if (!r.ok) { set(id, { busy: false, loading: false, error: j.error ?? "That did not work. Nothing was written." }); return null; }
      return j;
    } catch { set(id, { busy: false, loading: false, error: "Product Velocity could not be reached. Nothing was written." }); return null; }
  };

  // the preview of every row that can be updated is read as soon as the list is known (a few at a time), so the person ticks with the result in front of them
  useEffect(() => {
    const todo = docs.filter((d) => (d.state === "send" || d.state === "receive") && !asked.current.has(d.id));
    if (todo.length === 0) return;
    for (const d of todo) asked.current.add(d.id);
    setRows((r) => ({ ...r, ...Object.fromEntries(todo.map((d) => [d.id, { ...r[d.id], loading: true }])) }));
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const d = todo[next++]!;
        const j = await call(d.id, { action: d.state === "send" ? "preview" : "refresh-preview" });
        if (!j) continue;
        const row: Row = d.state === "send" ? { loading: false, ...(j.preview ? { preview: j.preview } : {}) } : { loading: false, ...(j.refresh ? { refresh: j.refresh } : {}) };
        setRows((r) => ({ ...r, [d.id]: { ...r[d.id], ...row } }));
        setPicked((p) => (d.id in p ? p : { ...p, [d.id]: tickedAtFirst(d, row) }));
      }
    };
    void Promise.all(Array.from({ length: Math.min(PREVIEW_AT_ONCE, todo.length) }, worker));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `call` only sets state
  }, [docs]);

  const open = docs.filter((d) => !rows[d.id]?.done);
  const chosen = open.filter((d) => picked[d.id] && canApply(d, rows[d.id] ?? {}));
  useEffect(() => { onCount?.(open.length); }, [open.length, onCount]);

  const applyOne = async (d: ToSend) => {
    const r = rows[d.id] ?? {};
    set(d.id, { busy: true, error: "" });
    const j = d.state === "send"
      ? await call(d.id, { action: "publish", confirm: r.preview?.confirm })
      : await call(d.id, { action: "refresh", confirm: r.refresh?.confirm });
    if (j?.done) { set(d.id, { busy: false, done: j.done.message }); setPicked((p) => ({ ...p, [d.id]: false })); return true; }
    return false;
  };
  const apply = async () => {
    setApplying(true);
    let any = false;
    for (const d of chosen) if (await applyOne(d)) any = true;
    setApplying(false);
    if (any) onSent?.();
  };

  if (docs.length === 0 || !show) return null;
  const selectable = open.filter((d) => canApply(d, rows[d.id] ?? {}));
  const allOn = selectable.length > 0 && selectable.every((d) => picked[d.id]);
  return (
    <section className="sync-section" aria-label="Confluence pages to update">
      <header className="sync-section-head">
        <span className="sync-tag">Confluence</span>
        <h3>Updates between Product Velocity and Confluence ({open.length})</h3>
      </header>
      <p>Nothing is written to Confluence until you confirm. If you send, only the text of the document goes out, with no note and no link back to Product Velocity. A page that changed in Confluence is read into its document only when you confirm. The previews below are already loaded: tick the updates to apply.</p>
      {selectable.length > 1 && (
        <label className="sync-all"><input type="checkbox" checked={allOn} onChange={(e) => setPicked((p) => ({ ...p, ...Object.fromEntries(selectable.map((d) => [d.id, e.target.checked])) }))} /> Select all ({selectable.length})</label>
      )}
      <ul className="push-list sync-list" aria-label="Confluence pages to update">
        {docs.map((d) => {
          const r = rows[d.id] ?? {};
          const pill = pillOf(d, Boolean(r.done));
          const can = !r.done && canApply(d, r);
          const on = can && Boolean(picked[d.id]);
          const warnings = r.preview?.warnings ?? [];
          return (
            <li key={d.id} className={`sync-row${on ? " sync-row-on" : ""}`}>
              <label className="sync-row-main">
                <input type="checkbox" checked={on} disabled={!can || applying} aria-label={`Apply the update for ${d.code} ${d.title}`} onChange={(e) => setPicked((p) => ({ ...p, [d.id]: e.target.checked }))} />
                <span>
                  <strong>{d.code}</strong> {d.itemName} · {d.title} · <StatusPill value={pill.word} tone={pill.tone} />
                </span>
              </label>
              <div className="sync-row-body">
                <a href={d.pageUrl} target="_blank" rel="noopener noreferrer">{d.pageTitle || "the page"}</a>{" "}
                <span className="muted">(space {d.spaceKey}; {sideOf(d)}). {whyOf(d)}</span>
                {r.loading && <p role="status" className="muted">Reading the page…</p>}
                {r.done && <p role="status">{r.done}</p>}
                {r.error && <p role="alert" className="error">{r.error}</p>}
                {!r.done && (d.state === "conflict" || d.state === "gone") && <p className="muted">{d.state === "conflict" ? "Both sides changed, so you choose which to keep." : "Decide whether to make a new page or stop linking."} Open the document’s menu on the Spec tab (Confluence sync).</p>}
                {!r.done && r.preview && (
                  <>
                    <p><strong>{r.preview.action === "update" ? "The page will be updated." : r.preview.action === "none" ? "Nothing to publish" : r.preview.action === "conflict" ? "The page was changed in Confluence" : "The page is gone"}</strong>{r.preview.action === "update" ? "" : `: ${r.preview.why}`}</p>
                    {warnings.length > 0 && <p role="alert" className="notice"><strong>This text may be commercial.</strong> Check who can read the page before you tick it: {warnings.map((w) => `${WARNING_WORD[w.kind] ?? "Something"} (${w.what})`).join("; ")}.</p>}
                    {r.preview.notes.map((n) => <p key={n} className="muted">{n}</p>)}
                    {(r.preview.action === "conflict" || r.preview.action === "gone") && <p className="muted">Open the document’s menu on the Spec tab (Confluence sync) to decide what to do.</p>}
                  </>
                )}
                {!r.done && r.refresh && (
                  <>
                    <p><strong>{r.refresh.action === "update" ? "The document will be updated from the page." : r.refresh.action === "unchanged" ? "Nothing to update" : "The page is gone"}</strong>{r.refresh.action === "update" ? "" : `: ${r.refresh.why}`}</p>
                    {r.refresh.action === "update" && (
                      <details>
                        <summary>See the text that comes in</summary>
                        <pre className="import-excerpt" tabIndex={0} aria-label="The text that would come in (start)">{r.refresh.excerpt}{r.refresh.truncated ? "\n…" : ""}</pre>
                      </details>
                    )}
                    {r.refresh.lost.length > 0 && <p role="status" className="notice"><strong>Not carried over.</strong> {r.refresh.lost.join(" ")}</p>}
                    {r.refresh.notes.map((n) => <p key={n} className="muted">{n}</p>)}
                    {r.refresh.localEdits && r.refresh.action === "update" && <p role="alert" className="notice">The document was also changed here, so this is a conflict. Open the document’s menu on the Spec tab (Confluence sync) to choose which side to keep.</p>}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="sync-section-foot">
        <span className="muted" role="status">{chosen.length === 0 ? "No Confluence update ticked." : `${chosen.length} ${chosen.length === 1 ? "update" : "updates"} ticked.`}</span>
        <button type="button" className="btn btn-primary" disabled={chosen.length === 0 || applying} onClick={() => void apply()}>{applying ? "Updating…" : chosen.length === 0 ? "Apply Confluence updates" : `Apply ${chosen.length} Confluence ${chosen.length === 1 ? "update" : "updates"}`}</button>
      </div>
    </section>
  );
}
