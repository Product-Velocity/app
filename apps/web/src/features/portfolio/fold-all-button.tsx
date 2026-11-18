"use client";

/**
 * The square icon button of the action bars (Roadmap grid and Changes report) that folds or unfolds every group at once.
 * It sits next to Columns / Group by and is only enabled when there is something to fold: `keys` are all the foldable
 * rows (groups, and the issues under initiatives), `collapsed` which of them are folded now.
 */
export function FoldAllButton({ keys, collapsed, onChange, what = "groups" }: {
  keys: readonly string[]; collapsed: ReadonlySet<string>; onChange: (next: Set<string>) => void; what?: string;
}) {
  const none = keys.length === 0;
  const allCollapsed = !none && keys.every((k) => collapsed.has(k));
  const label = allCollapsed ? `Expand all ${what}` : `Collapse all ${what}`;
  const title = none ? `Nothing to fold: group the rows first` : allCollapsed ? `Show the rows of every group` : `Fold the rows of every group away`;
  return (
    <button
      type="button" className="btn pvbar-undo" aria-label={label} title={title} disabled={none} aria-pressed={allCollapsed}
      onClick={() => {
        const next = new Set(collapsed);
        for (const k of keys) { if (allCollapsed) next.delete(k); else next.add(k); }
        onChange(next);
      }}
    >
      {allCollapsed ? (
        // unfold: arrows pointing away from the middle
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></svg>
      ) : (
        // fold: arrows pointing to the middle
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m7 20 5-5 5 5" /><path d="m7 4 5 5 5-5" /></svg>
      )}
    </button>
  );
}
