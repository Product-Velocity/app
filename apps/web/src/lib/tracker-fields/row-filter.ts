// Search, "linked only" and paging of the long tables of the tracker settings (repositories, projects). Pure, so the rules are tested without a browser.

export type RowInfo = { text: string; linked: boolean };

/** Which rows to show: those that match every typed word (and are linked, when asked), cut to the first `limit`. Returns a flag per row and how many matched. */
export function visibleRows(rows: readonly RowInfo[], q: { text: string; linkedOnly: boolean; limit: number }): { show: boolean[]; matched: number } {
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
  let matched = 0;
  const show = rows.map((r) => {
    const ok = (!q.linkedOnly || r.linked) && words.every((w) => r.text.toLowerCase().includes(w));
    if (!ok) return false;
    matched++;
    return matched <= q.limit;
  });
  return { show, matched };
}
