// The fold button steps through the nesting levels of a grid (issue #663): each press is the next action, then it reverses.
// Closing: the deepest level first, then the one above it, up to the first level. Opening: the first level first, then the next, down to the deepest.
// With three levels that is: collapse 3, collapse 2, collapse 1, expand 1, expand 2, expand 3, collapse 3, and so on.
// The state is the set of collapsed keys; the direction is remembered by the button. Whatever the person folded by hand in between, the next press
// acts on what is there: closing takes the deepest level that is not fully collapsed, opening takes the first level that is collapsed.

export type FoldLevel = { name: string; keys: readonly string[] };
export type Direction = "close" | "open";
export type FoldStep = { next: Set<string>; direction: Direction; action: "collapse" | "expand"; level: number; name: string; step: number; steps: number };

const fully = (collapsed: ReadonlySet<string>, l: FoldLevel) => l.keys.length > 0 && l.keys.every((k) => collapsed.has(k));

/** Levels from the keys of the groups: a "Then by" group key holds its parent's key before a ">" (see buildGroupedRows), so its depth is the number of ">". */
export function levelsOfKeys(keys: readonly string[], names: readonly string[] = ["groups", "sub-groups", "sub-sub-groups"]): FoldLevel[] {
  const by = new Map<number, string[]>();
  for (const k of keys) { const d = k.split(">").length - 1; by.set(d, [...(by.get(d) ?? []), k]); }
  return [...by.keys()].sort((a, b) => a - b).map((d) => ({ name: names[Math.min(d, names.length - 1)]!, keys: by.get(d)! }));
}

/** Where the button is in its cycle, for its label: 1-based position of the NEXT press among the 2n presses of a full cycle. */
function position(levels: FoldLevel[], collapsed: ReadonlySet<string>, direction: Direction): number {
  const n = levels.length;
  const closed = levels.filter((l) => fully(collapsed, l)).length;
  return direction === "close" ? closed + 1 : n + (n - closed) + 1;
}

/** The next press: which level is folded or unfolded, the collapsed set after it, and the direction the button now goes. Null when there is nothing to fold. */
export function nextFold(all: readonly FoldLevel[], collapsed: ReadonlySet<string>, direction: Direction): FoldStep | null {
  const levels = all.filter((l) => l.keys.length > 0);
  if (levels.length === 0) return null;
  const n = levels.length;
  let dir = direction;
  const deepestOpen = () => { for (let i = n - 1; i >= 0; i--) if (!fully(collapsed, levels[i]!)) return i; return -1; };
  const firstClosed = () => { for (let i = 0; i < n; i++) if (fully(collapsed, levels[i]!) || levels[i]!.keys.some((k) => collapsed.has(k))) return i; return -1; };
  let i = dir === "close" ? deepestOpen() : firstClosed();
  if (i === -1) { // the end of the run: turn round
    dir = dir === "close" ? "open" : "close";
    i = dir === "close" ? deepestOpen() : firstClosed();
    if (i === -1) return null;
  }
  const level = levels[i]!;
  const next = new Set(collapsed);
  const collapse = dir === "close";
  for (const k of level.keys) { if (collapse) next.add(k); else next.delete(k); }
  return { next, direction: dir, action: collapse ? "collapse" : "expand", level: i + 1, name: level.name, step: position(levels, collapsed, dir), steps: 2 * n };
}

/** What the button says before it is pressed: the same decision without the new state. */
export function describeNext(levels: readonly FoldLevel[], collapsed: ReadonlySet<string>, direction: Direction): { label: string; title: string } | null {
  const s = nextFold(levels, collapsed, direction);
  if (!s) return null;
  const total = levels.filter((l) => l.keys.length > 0).length;
  const verb = s.action === "collapse" ? "Collapse" : "Expand";
  const label = total > 1 ? `${verb} level ${s.level} (${s.name})` : `${verb} all ${s.name}`;
  return { label, title: total > 1 ? `${label}: step ${s.step} of ${s.steps}. Each press folds or unfolds the next level, then it reverses.` : s.action === "collapse" ? "Fold the rows of every group away" : "Show the rows of every group" };
}
