import { createHash } from "node:crypto";

// Everything that may leave the app for GitHub (CLAUDE.md rule 2). Repositories can be public, so this list is the
// ONLY place a field is allowed to be read for a GitHub payload: value, confidence, customers, decisions, rationale,
// key results, outcomes and markets are never listed, and a test fails if any of them ever reaches a payload.
export const OUTBOUND_ITEM_FIELDS = ["item_code", "initiative_name", "summary", "hypothesis"] as const;
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
};
export type TrackingIssue = { title: string; block: string; labels: string[]; hash: string };

export const BLOCK_START = "<!-- pv:begin";
export const BLOCK_END = "<!-- pv:end -->";
export const MARKER = (itemId: string) => `<!-- pv:begin item=${itemId} -->`;
export const BASE_LABEL = "product-velocity";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** User text goes into a GitHub issue: no markers of ours, no @mentions that would notify strangers. */
export function sanitize(s: string): string {
  return s
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@​");
}
const linkLabel = (s: string) => sanitize(s).replace(/[[\]\n\r]/g, " ").trim().slice(0, 120) || "link";

export function projectLabel(projectName: string): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `pv:project/${slug || "project"}`;
}

export function buildTrackingIssue(i: TrackingIssueInput): TrackingIssue {
  const code = text(i.item.item_code, 20);
  const name = text(i.item.initiative_name, 200);
  const summary = sanitize(text(i.item.summary, 4000));
  const hypothesis = sanitize(text(i.item.hypothesis, 4000));
  const links = i.artifacts.filter((a) => /^https?:\/\//i.test(a.url) && !/[\s()<>]/.test(a.url)).slice(0, 20);

  const parts = [MARKER(i.itemId)];
  if (summary) parts.push("", "## Summary", summary);
  if (hypothesis) parts.push("", "## Hypothesis (IF / THEN / RESULTING IN)", hypothesis);
  if (links.length) parts.push("", "## Artifacts", ...links.map((a) => `- [${linkLabel(a.label)}](${a.url})`));
  parts.push("", "---", `Managed by Product Velocity: edits between the markers are overwritten, text outside them is kept. [Open in Product Velocity](${i.appUrl}/portfolio/${i.itemId})`, BLOCK_END);

  const title = (code ? `${code}: ${name}` : name) || "Untitled initiative";
  const labels = [BASE_LABEL, projectLabel(i.projectName)];
  const block = parts.join("\n");
  return { title, block, labels, hash: createHash("sha256").update(JSON.stringify({ title, labels, block })).digest("hex") };
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
