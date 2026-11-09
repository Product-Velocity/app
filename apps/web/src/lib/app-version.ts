export type ReleaseEntry = {
  version: string;
  date: string;
  title: string;
  summary: string;
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

/** Extracts the bold lead sentence (`**Title.**`) and full summary from a RELEASES.md cell. */
export function splitReleaseCell(rawCell: string): { title: string; summary: string } {
  const unescaped = rawCell.replace(/\\\|/g, "|").trim();
  const boldMatch = /^\*\*(.+?)\*\*\s*(.*)$/.exec(unescaped);
  if (boldMatch) {
    const title = cleanMarkdown(boldMatch[1] ?? "").replace(/\.$/, "");
    const rest = cleanMarkdown(boldMatch[2] ?? "");
    const summary = rest ? `${title}. ${rest}` : `${title}.`;
    return { title, summary };
  }
  const summary = cleanMarkdown(unescaped);
  const firstSentence = summary.split(/(?<=\.)\s+/)[0] ?? summary;
  return { title: firstSentence.replace(/\.$/, ""), summary };
}

/** Parses the Markdown table in docs/RELEASES.md and returns the newest `limit` entries. */
export function parseReleaseLog(markdown: string, limit = 10): ReleaseEntry[] {
  const entries: ReleaseEntry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = ROW_RE.exec(line.trim());
    if (!m) continue;
    const [, version, date, cell, pr] = m;
    if (!version || !date || !cell) continue;
    const { title, summary } = splitReleaseCell(cell);
    entries.push({ version, date, title, summary, pr: (pr ?? "").trim() });
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
