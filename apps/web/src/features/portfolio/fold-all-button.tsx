"use client";

/**
 * The square icon button of the action bars (Roadmap grid and Changes report) that folds or unfolds the groups. With one level it toggles them all;
 * with several (Group by, Then by, the issues under initiatives) each press is the next step: fold the deepest level, then the one above, up to the
 * first, then unfold the first, then the next, and again (issue #663, `fold-levels.ts`). It is only enabled when there is something to fold:
 * `keys` are all the foldable rows (their level is read from the key), or `levels` names the levels explicitly; `collapsed` is what is folded now.
 */
import { useState } from "react";
import { describeNext, levelsOfKeys, nextFold, type Direction, type FoldLevel } from "./fold-levels";

export function FoldAllButton({ keys, levels, collapsed, onChange, what = "groups" }: {
  keys: readonly string[]; /** The levels, outermost first, when the keys alone do not say (the issues under initiatives are a level of their own). */ levels?: readonly FoldLevel[]; collapsed: ReadonlySet<string>; onChange: (next: Set<string>) => void; what?: string;
}) {
  const [direction, setDirection] = useState<Direction>("close");
  const all = levels ?? levelsOfKeys(keys, [what, `sub-${what}`, `sub-sub-${what}`]);
  const info = describeNext(all, collapsed, direction);
  const none = info === null;
  const step = nextFold(all, collapsed, direction);
  const expanding = step?.action === "expand";
  const label = info?.label ?? `Collapse all ${what}`;
  const title = none ? `Nothing to fold: group the rows first` : info.title;
  return (
    <button
      type="button" className="btn pvbar-undo" aria-label={label} title={title} disabled={none}
      onClick={() => {
        if (!step) return;
        setDirection(step.direction);
        onChange(step.next);
      }}
    >
      {expanding ? (
        // unfold: arrows pointing away from the middle
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></svg>
      ) : (
        // fold: arrows pointing to the middle
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m7 20 5-5 5 5" /><path d="m7 4 5 5 5-5" /></svg>
      )}
    </button>
  );
}
