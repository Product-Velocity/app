import type { ChangeRowData } from "@pv/domain";

/**
 * "Since you last looked" (issue #635, slice P2): the changes that happened after the moment this person last marked the feed as seen, without
 * their own changes. The moment is kept per device, in the browser, so there is no new table; a person who never marks anything sees the last 3 days.
 */
export const DEFAULT_WINDOW_DAYS = 3;
export const SHOWN_LIMIT = 30;
const key = (tenantId: string) => `pv:last-look:${tenantId}`;

type Store = Pick<Storage, "getItem" | "setItem">;

export function readLastLook(store: Store | null, tenantId: string, now: Date): Date {
  try {
    const v = store?.getItem(key(tenantId));
    const t = v ? Date.parse(v) : NaN;
    if (!Number.isNaN(t) && t <= now.getTime()) return new Date(t);
  } catch { /* storage blocked: fall back to the default window */ }
  return new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);
}
export function writeLastLook(store: Store | null, tenantId: string, now: Date): boolean {
  try { store?.setItem(key(tenantId), now.toISOString()); return !!store; } catch { return false; }
}

/** Changes after `since` that someone else made (or the tracker or system made), newest first. Input is newest first. */
export function changesSince(rows: readonly ChangeRowData[], since: Date, me: string | null): ChangeRowData[] {
  return rows.filter((r) => Date.parse(r.at) > since.getTime() && !(me && r.actorId === me));
}

/** "in the last 3 days", "since yesterday", "since Friday", "since 12 Nov". */
export function sinceWords(since: Date, now: Date): string {
  const days = Math.floor((now.getTime() - since.getTime()) / 86_400_000);
  if (days < 1) return "since this morning";
  if (days === 1) return "since yesterday";
  if (days < 7) return `since ${since.toLocaleDateString("en-GB", { weekday: "long" })}`;
  return `since ${since.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}
