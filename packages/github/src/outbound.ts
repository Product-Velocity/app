import { createHash } from "node:crypto";

// Everything that may leave the app for GitHub (CLAUDE.md rule 2). Repositories can be public, so this list is the
// ONLY place a field is allowed to be read for a GitHub payload: value, confidence, customers, decisions, rationale,
// key results, outcomes and markets are never listed, and a test fails if any of them ever reaches a payload.
export const OUTBOUND_ITEM_FIELDS = ["item_code", "initiative_name", "summary", "description", "hypothesis", "moscow", "stack_rank", "change_type", "g2m_date_est", "theme", "priority"] as const;
export type OutboundField = (typeof OUTBOUND_ITEM_FIELDS)[number];

export type Artifact = { label: string; url: string };
export type TrackingIssueInput = {
  /** Read through the allowlist only. */
  item: Record<string, unknown>;
  itemId: string;
  projectName: string;
  /** Public address of this app, for the backlink (no trailing slash). */
  appUrl: string;
  artifacts: Artifact[];
  /** Files with a login-free share link. The caller passes them ONLY for a private repository: anyone who can read the issue can open them. */
  files?: Artifact[];
};
export type Milestone = { title: string; dueOn: string };
export type TrackingIssue = {
  title: string; block: string; labels: string[]; hash: string;
  /** Calendar quarter of the item's G2M date, or null without a date. Never written as text in the body. */
  milestone: Milestone | null;
  /** GitHub issue-type names to try, best first; the first the organisation has is used (the `pv:type/` label always goes along). */
  typeCandidates: string[];
};

export const BLOCK_START = "<!-- pv:begin";
export const BLOCK_END = "<!-- pv:end -->";
export const MARKER = (itemId: string) => `<!-- pv:begin item=${itemId} -->`;
export const BASE_LABEL = "product-velocity";
/** Labels in this namespace belong to Product Velocity: a push adds the ones an item should have and removes the ones it should not. */
export const OWNED_LABEL_PREFIX = "pv:";

const MOSCOW: Record<string, string> = { Must: "must", Should: "should", Could: "could", "Won't": "wont" };
/** "pv:moscow/must" for a known MoSCoW value, otherwise no label. */
export function moscowLabel(v: unknown): string | null {
  const slug = typeof v === "string" ? MOSCOW[v] : undefined;
  return slug ? `${OWNED_LABEL_PREFIX}moscow/${slug}` : null;
}
/** Where an item sits in the global rank, as a band, never the number (the exact rank stays in the app): top 10, top 25, top 50, later. */
export function rankBandLabel(rank: unknown): string | null {
  const n = typeof rank === "number" ? rank : NaN;
  if (!Number.isFinite(n) || n < 1) return null;
  return `${OWNED_LABEL_PREFIX}rank/${n <= 10 ? "top-10" : n <= 25 ? "top-25" : n <= 50 ? "top-50" : "later"}`;
}

const CHANGE_TYPES: Record<string, { slug: string; types: string[] }> = {
  "New feature": { slug: "new-feature", types: ["Feature"] },
  "Improvement to existing feature": { slug: "improvement", types: ["Improvement", "Enhancement"] },
};
/** "pv:type/new-feature" for a known Change Type, otherwise no label. */
export function changeTypeLabel(v: unknown): string | null {
  const t = typeof v === "string" ? CHANGE_TYPES[v] : undefined;
  return t ? `${OWNED_LABEL_PREFIX}type/${t.slug}` : null;
}
export function issueTypeCandidates(v: unknown): string[] {
  return (typeof v === "string" ? CHANGE_TYPES[v]?.types : undefined) ?? [];
}
/** The calendar quarter of a yyyy-mm-dd date as a milestone ("2026 Q4", due on the quarter's last day), or null for anything else. */
export function milestoneFor(date: unknown): Milestone | null {
  const m = typeof date === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  const q = Math.ceil(mo / 3);
  const last = new Date(Date.UTC(y, q * 3, 0)).getUTCDate();
  return { title: `${y} Q${q}`, dueOn: `${y}-${String(q * 3).padStart(2, "0")}-${last}T12:00:00Z` };
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** User text goes into a GitHub issue: no markers of ours, no @mentions that would notify strangers. */
export function sanitize(s: string): string {
  return s
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@​");
}
const linkLabel = (s: string) => sanitize(s).replace(/[[\]\n\r]/g, " ").trim().slice(0, 120) || "link";

/** "pv:priority/p1" for P0 to P3, otherwise no label. */
export function priorityLabel(v: unknown): string | null {
  return typeof v === "string" && /^P[0-3]$/.test(v) ? `${OWNED_LABEL_PREFIX}priority/${v.toLowerCase()}` : null;
}

/** Initiative Group as "pv:group/<name>". */
export function groupLabel(v: unknown): string | null {
  const slug = typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") : "";
  return slug ? `${OWNED_LABEL_PREFIX}group/${slug}` : null;
}

export function projectLabel(projectName: string): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `pv:project/${slug || "project"}`;
}

export function buildTrackingIssue(i: TrackingIssueInput): TrackingIssue {
  const code = text(i.item.item_code, 20);
  const name = text(i.item.initiative_name, 200);
  const summary = sanitize(text(i.item.summary, 4000));
  const description = sanitize(text(i.item.description, 20000));
  const hypothesis = sanitize(text(i.item.hypothesis, 4000));
  const links = i.artifacts.filter((a) => /^https?:\/\//i.test(a.url) && !/[\s()<>]/.test(a.url)).slice(0, 20);

  const files = (i.files ?? []).filter((a) => /^https?:\/\//i.test(a.url) && !/[\s()<>]/.test(a.url)).slice(0, 20);

  const parts = [MARKER(i.itemId)];
  if (summary) parts.push("", "## Summary", summary);
  if (description) parts.push("", "## Description", description);
  if (hypothesis) parts.push("", "## Hypothesis (IF / THEN / RESULTING IN)", hypothesis);
  if (links.length) parts.push("", "## Artifacts", ...links.map((a) => `- [${linkLabel(a.label)}](${a.url})`));
  if (files.length) parts.push("", "## Files", ...files.map((a) => `- [${linkLabel(a.label)}](${a.url})`));
  parts.push("", "---", `Managed by Product Velocity: edits between the markers are overwritten, text outside them is kept. [Open in Product Velocity](${i.appUrl}/portfolio/${encodeURIComponent(code)})`, BLOCK_END);

  const title = (code ? `${code}: ${name}` : name) || "Untitled initiative";
  const labels = [BASE_LABEL, projectLabel(i.projectName), moscowLabel(i.item.moscow), rankBandLabel(i.item.stack_rank), changeTypeLabel(i.item.change_type), groupLabel(i.item.theme), priorityLabel(i.item.priority)].filter((l): l is string => !!l);
  const block = parts.join("\n");
  const milestone = milestoneFor(i.item.g2m_date_est);
  return { title, block, labels, milestone, typeCandidates: issueTypeCandidates(i.item.change_type), hash: createHash("sha256").update(JSON.stringify({ title, labels, block, milestone })).digest("hex") };
}

/** Puts the managed block into an issue body: replaces the old block, keeps everything outside it, appends if there is none. */
export function mergeBody(existing: string | null | undefined, block: string): string {
  const body = existing ?? "";
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END, start);
  if (start !== -1 && end !== -1) return body.slice(0, start) + block + body.slice(end + BLOCK_END.length);
  return body.trim() ? `${body.replace(/\s+$/, "")}\n\n${block}` : block;
}

/** The text outside the managed block, which a push never touches. */
export function outsideBlock(body: string | null | undefined): string {
  const b = body ?? "";
  const start = b.indexOf(BLOCK_START);
  const end = b.indexOf(BLOCK_END, start);
  return start !== -1 && end !== -1 ? (b.slice(0, start) + b.slice(end + BLOCK_END.length)).trim() : b.trim();
}
