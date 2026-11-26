// Pure helpers for the Confluence pickers (the space search and the page tree): what a search matches, in what order, and the path to a chosen page.

export type SpaceChoice = { key: string; name: string };

/** The spaces that match what was typed (name or key, any case, every word), the last used one first, otherwise by name. Never more than `max`. */
export function matchSpaces<T extends SpaceChoice>(spaces: T[], query: string, recentKey: string | null = null, max = 8): { shown: T[]; more: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = spaces.filter((s) => { const hay = `${s.name} ${s.key}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  const ordered = [...hits].sort((a, b) => (a.key === recentKey ? -1 : b.key === recentKey ? 1 : 0) || a.name.localeCompare(b.name));
  return { shown: ordered.slice(0, max), more: Math.max(0, ordered.length - max) };
}

export type TreeNode<P extends { id: string; title: string }> = { page: P; children: TreeNode<P>[] | "loading" | "error" | null; open: boolean };

const hit = (title: string, words: string[]) => { const t = title.toLowerCase(); return words.every((w) => t.includes(w)); };

/**
 * The tree reduced to what matches a search: a node stays when its title matches or something loaded below it does, and the nodes above a match are shown open.
 * Only nodes that are loaded can match, which is why the tree loads what it can before it searches. An empty search returns the tree as it is.
 */
export function filterTree<P extends { id: string; title: string }>(nodes: TreeNode<P>[], query: string): TreeNode<P>[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return nodes;
  const walk = (list: TreeNode<P>[]): TreeNode<P>[] => list.flatMap((n) => {
    const below = Array.isArray(n.children) ? walk(n.children) : [];
    if (below.length > 0) return [{ ...n, open: true, children: below }];
    return hit(n.page.title, words) ? [n] : [];
  });
  return walk(nodes);
}

/** The titles from the top of the tree down to the node with this id, or null when it is not loaded. */
export function pathTo<P extends { id: string; title: string }>(nodes: TreeNode<P>[], id: string): string[] | null {
  for (const n of nodes) {
    if (n.page.id === id) return [n.page.title];
    if (Array.isArray(n.children)) { const below = pathTo(n.children, id); if (below) return [n.page.title, ...below]; }
  }
  return null;
}

/** The ids of nodes still to load for a search, folders first (they hold the pages), at most `max`, with the path of ids to each. */
export function unloaded<P extends { id: string; title: string; kind?: string }>(nodes: TreeNode<P>[], max: number): string[][] {
  const out: { path: string[]; folder: boolean }[] = [];
  const walk = (list: TreeNode<P>[], path: string[]) => {
    for (const n of list) {
      const here = [...path, n.page.id];
      if (n.children === null) out.push({ path: here, folder: n.page.kind === "folder" });
      else if (Array.isArray(n.children)) walk(n.children, here);
    }
  };
  walk(nodes, []);
  return out.sort((a, b) => Number(b.folder) - Number(a.folder) || a.path.length - b.path.length).slice(0, max).map((x) => x.path);
}
