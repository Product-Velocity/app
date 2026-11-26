"use client";

import { useEffect, useId, useState } from "react";
import type { Choice, CommercialWarning, MergeChunk } from "@pv/domain";

type Preview = { chunks: MergeChunk[]; conflicts: number; page: { version: number; title: string; url: string | null }; documentVersion: number; warnings: CommercialWarning[]; notes: string[]; confirm: string };
const WARNING_WORD: Record<string, string> = { customer: "A customer", key_result: "A key result", value: "The business value", money: "An amount of money" };
const short = (t: string) => (t.length > 600 ? `${t.slice(0, 600)}…` : t) || "(nothing: this block was removed)";

/**
 * Merging a document and its Confluence page when both changed (issue #721). The text both started from is the stored version of the document that was last in
 * step; the changes are compared block by block. Blocks only one side changed come through on their own and are listed here so nothing is hidden; blocks both
 * sides changed differently are shown side by side and the person picks one (or keeps both). One Confirm saves the merged text as a new version of the document and
 * writes it to the page, so both end identical; the text each side had stays as a previous version and in the page history. Nothing is written before Confirm.
 */
export function ConfluenceMergeDialog({ doc, onClose, onChanged }: { doc: { id: string; title: string }; onClose: () => void; onChanged: () => void }) {
  const titleId = useId();
  const [p, setP] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/documents/${doc.id}/confluence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, j: (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string } };
  };
  useEffect(() => {
    let live = true;
    void post({ action: "merge-preview" })
      .then(({ ok, j }) => { if (!live) return; if (ok) setP(j.merge as Preview); else setError(j.error ?? "The two texts could not be compared."); })
      .catch(() => { if (live) setError("Product Velocity could not be reached."); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const conflictIdx = p ? p.chunks.flatMap((c, i) => (c.kind === "conflict" ? [i] : [])) : [];
  const open = conflictIdx.filter((i) => choices[i] === undefined).length;
  const auto = p ? p.chunks.filter((c) => c.kind === "ours" || c.kind === "theirs" || c.kind === "both") : [];

  const confirm = async () => {
    if (!p) return;
    setBusy(true); setError(null);
    try {
      const { ok, j } = await post({ action: "merge", confirm: p.confirm, choices });
      if (!ok) { setError(j.error ?? "That did not work. Check the document and the page."); return; }
      setDone(String((j.done as { message?: string } | undefined)?.message ?? "Merged."));
      onChanged();
    } catch { setError("Product Velocity could not be reached."); } finally { setBusy(false); }
  };

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog dialog-narrow" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Merge the two texts: {doc.title}</h2>
        {!p && !error && <p role="status">Comparing the document with its page…</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {done && (
          <>
            <p role="status">{done}</p>
            <div className="dialog-actions"><button type="button" className="btn btn-primary" onClick={onClose}>Close</button></div>
          </>
        )}
        {p && !done && (
          <>
            <p>
              Both the document (version {p.documentVersion}) and the page (version {p.page.version}) changed since they were last in step.{" "}
              <strong>{auto.length} change{auto.length === 1 ? "" : "s"} merged on {auto.length === 1 ? "its" : "their"} own</strong>
              {p.conflicts > 0 ? <>, <strong>{p.conflicts} block{p.conflicts === 1 ? "" : "s"} need{p.conflicts === 1 ? "s" : ""} your choice</strong>.</> : "."}
            </p>
            {p.notes.map((n) => <p key={n} className="muted">{n}</p>)}
            {p.warnings.length > 0 && <p role="alert" className="notice"><strong>This text may be commercial.</strong> Check who can read the page: {p.warnings.map((w) => `${WARNING_WORD[w.kind] ?? "Something"} (${w.what})`).join("; ")}.</p>}

            {conflictIdx.map((i, n) => {
              const c = p.chunks[i] as Extract<MergeChunk, { kind: "conflict" }>;
              const name = `${titleId}-c${i}`;
              return (
                <fieldset key={i} className="push-conflict">
                  <legend><strong>Both changed · block {n + 1} of {conflictIdx.length}</strong></legend>
                  <div className="push-sides">
                    <div><strong>Product Velocity</strong><pre className="push-body">{short(c.ours)}</pre></div>
                    <div><strong>Confluence</strong><pre className="push-body">{short(c.theirs)}</pre></div>
                  </div>
                  <details><summary>What it said before</summary><pre className="push-body">{short(c.base)}</pre></details>
                  <label><input type="radio" name={name} checked={choices[i] === "ours"} onChange={() => setChoices({ ...choices, [i]: "ours" })} /> Keep Product Velocity’s</label>{" "}
                  <label><input type="radio" name={name} checked={choices[i] === "theirs"} onChange={() => setChoices({ ...choices, [i]: "theirs" })} /> Keep Confluence’s</label>{" "}
                  <label><input type="radio" name={name} checked={choices[i] === "both"} onChange={() => setChoices({ ...choices, [i]: "both" })} /> Keep both, one after the other</label>
                </fieldset>
              );
            })}

            {auto.length > 0 && (
              <details>
                <summary>The {auto.length} change{auto.length === 1 ? "" : "s"} merged on {auto.length === 1 ? "its" : "their"} own</summary>
                <ul className="push-list">
                  {auto.map((c, i) => (
                    <li key={i}>
                      <strong>{c.kind === "ours" ? "Changed in Product Velocity" : c.kind === "theirs" ? "Changed in Confluence" : "Changed the same way on both sides"}</strong>
                      <pre className="push-body">{short("text" in c ? c.text : "")}</pre>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {open > 0 && <p role="status" className="muted">Choose for {open === 1 ? "the block above" : `all ${open} blocks above`} to continue.</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy || open > 0} onClick={() => void confirm()}>{busy ? "Saving…" : "Confirm: save the merged text and update the page"}</button>
            </div>
          </>
        )}
        {!p && error && <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>}
      </div>
    </div>
  );
}
