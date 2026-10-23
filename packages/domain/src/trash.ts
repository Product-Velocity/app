/** Delete, Trash and restore: the rules the grid mirrors from the database (migration 0017). */
export const TRASH_DAYS = 30;

/** Admins delete any item; creators the items they added; viewers, commenters and leadership none. */
export function canDeleteItem(role: string | null | undefined, userId: string | null | undefined, createdBy: string | null | undefined): boolean {
  if (role === "admin") return true;
  return role === "creator" && !!userId && createdBy === userId;
}
export const canSeeTrash = (role: string | null | undefined) => role === "creator" || role === "admin";
export const canPurge = (role: string | null | undefined) => role === "admin";

/** Ranks stay 1..N after a delete: the rows in rank order, renumbered. Mutates and returns the rows. */
export function closeGaps<T extends { stack_rank: number }>(rows: T[]): T[] {
  rows.sort((a, b) => a.stack_rank - b.stack_rank).forEach((r, i) => { r.stack_rank = i + 1; });
  return rows;
}

/**
 * The order after restoring: `live` ids in rank order; each restored item goes back to its old rank (or the end when
 * the list is shorter now), oldest rank first, the rest shifting down. Same algorithm as `restore_items`.
 */
export function placeRestored(live: readonly string[], restored: readonly { id: string; rank: number }[]): string[] {
  const order = [...live];
  for (const r of [...restored].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))) {
    const at = Math.min(r.rank, order.length + 1);
    order.splice(at - 1, 0, r.id);
  }
  return order;
}

/** Text of the confirmation: how many, the first few names, how many more. */
export function deleteSummary(names: readonly string[], show = 5) {
  return { title: `Delete ${names.length} ${names.length === 1 ? "initiative" : "initiatives"}?`, names: names.slice(0, show), more: Math.max(0, names.length - show) };
}

/** An item that has been decided on, is tracked on GitHub or has a status: Dropped or Cancelled keeps that story visible. */
export const hasHistory = (row: Record<string, unknown>) => !!(row.decision || row.status || row.github_issue_url);

export function daysLeftInTrash(deletedAt: string, now: number): number {
  const spent = Math.floor((now - Date.parse(deletedAt)) / 86_400_000);
  return Math.max(0, TRASH_DAYS - spent);
}
