// What the "Last Synced" and "Synced With" fields show. Both are derived from the GitHub link of an initiative; nothing is stored for them.

export type SyncLink = {
  mode: "push" | "follow";
  repo: string;
  issueNumber: number | null;
  syncState: "pending" | "synced" | "error";
  /** The last confirmed send. */
  lastPushedAt: string | null;
  /** The last time GitHub's state was applied (webhook, check). */
  ghSyncedAt: string | null;
  /** The initiative is on the linked GitHub Project board. */
  hasBoardItem: boolean;
};

const time = (v: unknown) => (typeof v === "string" && /^\d{4}-\d\d-\d\d/.test(v) && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);

/** The latest of the last send, the last check of GitHub and the item's own sync mark, as the original ISO string; null when none exists. */
export function lastSyncedAt(link: SyncLink | undefined, itemMark: string | null): string | null {
  if (!link) return null;
  const all = [link.lastPushedAt, link.ghSyncedAt, itemMark].filter((v): v is string => time(v) !== null);
  return all.length ? all.reduce((a, b) => (time(b)! > time(a)! ? b : a)) : null;
}

/** "GitHub · owner/repo · board "Name"", with a plain-words note when it only follows an issue, a send failed or nothing was sent yet. */
export function syncedWith(link: SyncLink | undefined, boardTitle: string | null): string {
  if (!link) return "";
  const parts = ["GitHub", link.repo];
  if (link.hasBoardItem && boardTitle) parts.push(`board "${boardTitle}"`);
  if (link.mode === "follow") parts.push(`follows ${link.issueNumber ? `#${link.issueNumber}` : "an issue"}, read-only`);
  else if (link.syncState === "error") parts.push("last send failed");
  else if (link.syncState === "pending" && !link.issueNumber) parts.push("not sent yet");
  return parts.join(" · ");
}
