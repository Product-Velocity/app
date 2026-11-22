export type ReleaseType = "new" | "improved" | "fixed" | "retired" | "security";

/** Order of the groups in the "What's new" dialog. */
export const RELEASE_TYPES: ReleaseType[] = ["new", "improved", "fixed", "retired", "security"];

export const RELEASE_TYPE_LABEL: Record<ReleaseType, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
  retired: "Retired",
  security: "Security",
};

export type ReleaseEntry = {
  version: string;
  date: string;
  title: string;
  /** Title and description in one sentence run (used in tooltips and the account menu). */
  summary: string;
  /** The description alone, without the title. Empty when the entry has only a title. */
  body: string;
  type: ReleaseType;
  pr: string;
};

export type VersionInfo = {
  version: string;
  build: string;
  latest: ReleaseEntry | null;
  releases: ReleaseEntry[];
};

const ROW_RE = /^\|\s*(\d+\.\d+\.\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/;

/** Strips simple inline Markdown (**bold**, `code`, escaped pipes) for clean UI display. */
function cleanMarkdown(text: string): string {
  return text
    .replace(/\\\|/g, "|")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const TYPE_MARK_RE = /^<!--\s*type:\s*(new|improved|fixed|retired|security)\s*-->\s*/i;

/** Older entries carry no type: "Fix..." reads as Fixed, "New..." and "Introducing..." as New, anything else as Improved. */
export function inferReleaseType(title: string): ReleaseType {
  if (/^(fix|fixed|fixes)\b/i.test(title)) return "fixed";
  if (/^(new|introducing|add|adds|added)\b/i.test(title)) return "new";
  return "improved";
}

/** Extracts the optional type mark, the bold lead sentence (`**Title.**`), the description and the full summary from a RELEASES.md cell. */
export function splitReleaseCell(rawCell: string): { title: string; summary: string; body: string; type: ReleaseType } {
  let unescaped = rawCell.replace(/\\\|/g, "|").trim();
  let marked: ReleaseType | null = null;
  const mark = TYPE_MARK_RE.exec(unescaped);
  if (mark) {
    marked = (mark[1] ?? "").toLowerCase() as ReleaseType;
    unescaped = unescaped.slice(mark[0].length);
  }
  const boldMatch = /^\*\*(.+?)\*\*\s*(.*)$/.exec(unescaped);
  if (boldMatch) {
    const title = cleanMarkdown(boldMatch[1] ?? "").replace(/\.$/, "");
    const body = cleanMarkdown(boldMatch[2] ?? "");
    const summary = body ? `${title}. ${body}` : `${title}.`;
    return { title, summary, body, type: marked ?? inferReleaseType(title) };
  }
  const summary = cleanMarkdown(unescaped);
  const firstSentence = summary.split(/(?<=\.)\s+/)[0] ?? summary;
  const title = firstSentence.replace(/\.$/, "");
  return { title, summary, body: summary.slice(firstSentence.length).trim(), type: marked ?? inferReleaseType(title) };
}

/** Parses the Markdown table in docs/RELEASES.md and returns the newest `limit` entries. */
export function parseReleaseLog(markdown: string, limit = 10): ReleaseEntry[] {
  const entries: ReleaseEntry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = ROW_RE.exec(line.trim());
    if (!m) continue;
    const [, version, date, cell, pr] = m;
    if (!version || !date || !cell) continue;
    const { title, summary, body, type } = splitReleaseCell(cell);
    entries.push({ version, date, title, summary, body, type, pr: (pr ?? "").trim() });
    if (entries.length >= limit) break;
  }
  return entries;
}

/** Compares two X.Y.Z version strings (> 0 when a > b, < 0 when a < b, 0 when equal). */
export function compareVersions(a: string, b: string): number {
  const pa = a.trim().replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.trim().replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * True when the server reports a newer release version than the client tab, or when both have
 * non-empty build commit hashes on the same version and they differ.
 */
export function hasVersionUpdate(
  client: { version?: string; build?: string },
  server: { version?: string; build?: string },
): boolean {
  const cv = (client.version ?? "").trim();
  const sv = (server.version ?? "").trim();
  if (!cv || !sv) return false;
  const cmp = compareVersions(sv, cv);
  if (cmp > 0) return true;
  if (cmp < 0) return false;
  const cb = (client.build ?? "").trim();
  const sb = (server.build ?? "").trim();
  return Boolean(cb && sb && cb !== sb);
}

/**
 * Returns the release entries that landed after `clientVersion` (newest first).
 * If only the build hash changed on the same version, returns the current version's entry so the user still gets context.
 */
export function releasesSince(clientVersion: string, releases: ReleaseEntry[]): ReleaseEntry[] {
  const cv = clientVersion.trim();
  if (!cv) return releases.slice(0, 1);
  const newer = releases.filter((r) => compareVersions(r.version, cv) > 0);
  if (newer.length > 0) return newer;
  return releases.slice(0, 1);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11-22" -> "22 November 2026" (no time zone maths: the date is already a calendar date). */
export function formatReleaseDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

export type ReleaseGroup = { type: ReleaseType; label: string; entries: ReleaseEntry[] };
export type ReleaseDay = { date: string; label: string; groups: ReleaseGroup[] };

/** Groups entries (newest first) by date, then by type in the fixed order; empty groups are left out. */
export function groupReleases(releases: ReleaseEntry[]): ReleaseDay[] {
  const days: ReleaseDay[] = [];
  for (const r of releases) {
    let day = days[days.length - 1];
    if (!day || day.date !== r.date) {
      day = { date: r.date, label: formatReleaseDate(r.date), groups: [] };
      days.push(day);
    }
    let group = day.groups.find((g) => g.type === r.type);
    if (!group) {
      group = { type: r.type, label: RELEASE_TYPE_LABEL[r.type], entries: [] };
      day.groups.push(group);
    }
    group.entries.push(r);
  }
  for (const d of days) d.groups.sort((a, b) => RELEASE_TYPES.indexOf(a.type) - RELEASE_TYPES.indexOf(b.type));
  return days;
}
