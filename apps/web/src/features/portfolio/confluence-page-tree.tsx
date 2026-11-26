"use client";

import { useEffect, useId, useState } from "react";

export type TreePage = { id: string; title: string };
type Node = { page: TreePage; children: Node[] | "loading" | "error" | null; open: boolean };

/**
 * The pages of a Confluence space as a tree (issue #693): the top-level pages first, each opening to its sub pages when asked. Choosing a page is a button press, so
 * it works with the keyboard (Tab to a row, Enter or Space to choose, the arrow button to open). Only titles are shown; the pages are read through the server with the
 * workspace's Confluence connection. `topLabel`, when given, adds a first choice for "no page" (the top of the space).
 */
export function ConfluencePageTree({ docId, spaceKey, selectedId, onSelect, topLabel, label }: {
  docId: string;
  spaceKey: string;
  selectedId: string | null;
  onSelect: (page: TreePage | null) => void;
  topLabel?: string;
  label: string;
}) {
  const labelId = useId();
  const [roots, setRoots] = useState<Node[] | "loading" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const fetchPages = async (qs: string): Promise<TreePage[] | null> => {
    try {
      const r = await fetch(`/api/documents/${docId}/confluence/pages?${qs}`);
      const j = (await r.json().catch(() => ({}))) as { pages?: TreePage[]; error?: string };
      if (!r.ok || !j.pages) { setError(j.error ?? "The pages could not be read."); return null; }
      setError(null);
      return j.pages;
    } catch { setError("Product Velocity could not be reached."); return null; }
  };

  useEffect(() => {
    let live = true;
    void fetch(`/api/documents/${docId}/confluence/pages?space=${encodeURIComponent(spaceKey)}`)
      .then(async (r) => ({ ok: r.ok, j: (await r.json().catch(() => ({}))) as { pages?: TreePage[]; error?: string } }))
      .catch(() => ({ ok: false, j: { error: "Product Velocity could not be reached." } as { pages?: TreePage[]; error?: string } }))
      .then(({ ok, j }) => {
        if (!live) return;
        if (ok && j.pages) setRoots(j.pages.map((page) => ({ page, children: null, open: false })));
        else { setError(j.error ?? "The pages could not be read."); setRoots("error"); }
      });
    return () => { live = false; };
  }, [docId, spaceKey]);

  /** Opens or closes one node (found by its path of ids), loading its sub pages the first time. */
  const toggle = async (path: string[]) => {
    const update = (nodes: Node[], depth: number, fn: (n: Node) => Node): Node[] => nodes.map((n) => (n.page.id !== path[depth] ? n : depth === path.length - 1 ? fn(n) : { ...n, children: Array.isArray(n.children) ? update(n.children, depth + 1, fn) : n.children }));
    const current = (nodes: Node[], depth: number): Node | undefined => { const n = nodes.find((x) => x.page.id === path[depth]); return !n || depth === path.length - 1 ? n : Array.isArray(n.children) ? current(n.children, depth + 1) : undefined; };
    if (!Array.isArray(roots)) return;
    const node = current(roots, 0);
    if (!node) return;
    if (node.open) { setRoots(update(roots, 0, (n) => ({ ...n, open: false }))); return; }
    if (Array.isArray(node.children)) { setRoots(update(roots, 0, (n) => ({ ...n, open: true }))); return; }
    setRoots((r) => (Array.isArray(r) ? update(r, 0, (n) => ({ ...n, open: true, children: "loading" })) : r));
    const pages = await fetchPages(`parent=${encodeURIComponent(node.page.id)}`);
    setRoots((r) => (Array.isArray(r) ? update(r, 0, (n) => ({ ...n, open: true, children: pages ? pages.map((page) => ({ page, children: null, open: false })) : "error" })) : r));
  };

  const render = (nodes: Node[], path: string[]) => (
    <ul role="group" className="page-tree-group">
      {nodes.map((n) => {
        const here = [...path, n.page.id];
        const selected = selectedId === n.page.id;
        return (
          <li key={n.page.id} role="treeitem" aria-selected={selected} aria-expanded={n.open}>
            <span className="page-tree-row">
              <button type="button" className="page-tree-toggle" aria-label={`${n.open ? "Close" : "Open"} the sub pages of ${n.page.title}`} onClick={() => void toggle(here)}>{n.open ? "▾" : "▸"}</button>
              <button type="button" className={selected ? "page-tree-pick page-tree-on" : "page-tree-pick"} aria-pressed={selected} onClick={() => onSelect({ id: n.page.id, title: n.page.title })}>{n.page.title}{selected ? " ✓" : ""}</button>
            </span>
            {n.open && n.children === "loading" && <p className="muted page-tree-note" role="status">Reading…</p>}
            {n.open && n.children === "error" && <p className="muted page-tree-note">The sub pages could not be read.</p>}
            {n.open && Array.isArray(n.children) && (n.children.length === 0 ? <p className="muted page-tree-note">No sub pages.</p> : render(n.children, here))}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="page-tree">
      <p className="dialog-label" id={labelId}>{label}</p>
      {roots === "loading" && <p className="muted" role="status">Reading the pages of the space…</p>}
      {roots === "error" && <p role="alert" className="notice">{error ?? "The pages could not be read."}</p>}
      {Array.isArray(roots) && (
        <div role="tree" aria-labelledby={labelId} className="page-tree-box">
          {topLabel && (
            <button type="button" className={selectedId === null ? "page-tree-pick page-tree-on page-tree-top" : "page-tree-pick page-tree-top"} aria-pressed={selectedId === null} onClick={() => onSelect(null)}>{topLabel}{selectedId === null ? " ✓" : ""}</button>
          )}
          {roots.length === 0 ? <p className="muted">This space has no pages yet.</p> : render(roots, [])}
        </div>
      )}
    </div>
  );
}
