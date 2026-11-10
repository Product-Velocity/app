/** Which items of a bar still fit, and which move into its "More" menu (issue #403). Pure, so it is tested without a browser. */
export type FitItem = {
  id: string;
  /** Measured width in pixels, without the gap. */
  width: number;
  /** Items with the higher rank move into the menu first; equal ranks go last-in-order first. */
  rank: number;
  /** Never moved into the menu (the open tab, search). */
  pinned?: boolean;
};

export type FitInput = { items: FitItem[]; /** Space for the row including the room a "More" button would take. */ available: number; /** Width of the "More" button. */ moreWidth: number; gap: number };

function rowWidth(widths: number[], gap: number): number {
  return widths.reduce((sum, w) => sum + w, 0) + Math.max(0, widths.length - 1) * gap;
}

/** The ids that do not fit. Empty when everything fits without a "More" button; otherwise room for the button is kept free. */
export function fitItems({ items, available, moreWidth, gap }: FitInput): string[] {
  if (rowWidth(items.map((i) => i.width), gap) <= available) return [];
  const kept = [...items];
  const hidden: string[] = [];
  // the order to give up: highest rank first, and within a rank the one furthest right
  const order = items
    .map((item, index) => ({ item, index }))
    .filter((x) => !x.item.pinned)
    .sort((a, b) => b.item.rank - a.item.rank || b.index - a.index);
  const room = () => available - moreWidth - gap;
  for (const { item } of order) {
    if (rowWidth(kept.map((i) => i.width), gap) <= room()) break;
    kept.splice(kept.indexOf(item), 1);
    hidden.push(item.id);
  }
  return hidden;
}
