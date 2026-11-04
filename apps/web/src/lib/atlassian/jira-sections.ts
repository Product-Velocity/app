import { createHash } from "node:crypto";
import { adfToText, isSimpleAdf, markdownToAdf, type AdfDoc, type AdfNode } from "./adf";

// The Jira description as headed sections (issue #319, decision 2026-11-04-jira-description-sections): the twin of the managed block of a GitHub issue.
// Summary, Description and Hypothesis are Product Velocity's texts and are compared one by one; Artifacts and Files are sent only. Pure functions.
// A Jira description that does not carry our headings (written before this existed, or typed in Jira) is read as the Description, so nothing breaks.

export const SECTIONS = [
  ["summary", "Summary"],
  ["description", "Description"],
  ["hypothesis", "Hypothesis (IF / THEN / RESULTING IN)"],
  ["artifacts", "Artifacts"],
  ["files", "Files"],
] as const;
export type SectionKey = (typeof SECTIONS)[number][0];
export const TEXT_SECTIONS = ["summary", "description", "hypothesis"] as const;
export type TextSection = (typeof TEXT_SECTIONS)[number];
export type Link = { label: string; url: string };

const doc = (content: AdfNode[]): AdfDoc => ({ type: "doc", version: 1, content });
export const nodesText = (nodes: AdfNode[] | undefined) => (nodes && nodes.length > 0 ? adfToText(doc(nodes)) : "");
const heading = (text: string): AdfNode => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
/** The text of a level-2 heading node, or null for any other node. */
const h2 = (n: AdfNode): string | null => (n.type === "heading" && (n.attrs as { level?: number } | undefined)?.level === 2 ? adfToText(doc([n])).trim() : null);

export type Split = {
  /** True when no heading of ours was found: the whole description is read as the Description. */
  legacy: boolean;
  /** What stands above our first heading (typed in Jira); never compared, kept when the description is rewritten. */
  head: AdfNode[];
  /** The content under each text heading, or undefined when the heading is absent. */
  nodes: Partial<Record<TextSection, AdfNode[]>>;
};

/** Cuts a Jira description (ADF) at our headings, in order. A heading that is out of order stays part of the section it is in. */
export function splitDescription(adf: unknown): Split {
  const top = typeof adf === "object" && adf !== null && Array.isArray((adf as AdfDoc).content) ? (adf as AdfDoc).content : [];
  const head: AdfNode[] = [];
  const found: Partial<Record<SectionKey, AdfNode[]>> = {};
  let next = 0;
  let current: AdfNode[] | null = null;
  for (const n of top) {
    const t = h2(n);
    const at = t === null ? -1 : SECTIONS.findIndex(([, name], i) => i >= next && name === t);
    if (at !== -1) { next = at + 1; current = []; found[SECTIONS[at]![0]] = current; continue; }
    (current ?? head).push(n);
  }
  if (Object.keys(found).length === 0) return { legacy: true, head: [], nodes: top.length > 0 ? { description: top } : {} };
  const nodes: Split["nodes"] = {};
  for (const k of TEXT_SECTIONS) if (found[k]) nodes[k] = found[k]!;
  return { legacy: false, head, nodes };
}

/** Whether replacing these nodes would lose something this converter cannot write back (a macro, a mention, a merged table). */
export const isSimpleNodes = (nodes: AdfNode[] | undefined) => !nodes || nodes.length === 0 || isSimpleAdf(doc(nodes));

const safeLinks = (links: Link[] | undefined) => (links ?? []).filter((a) => /^https?:\/\//i.test(a.url) && !/[\s()<>]/.test(a.url)).slice(0, 20);
const label = (s: string) => s.replace(/[[\]\n\r]/g, " ").trim().slice(0, 120) || "link";
const bullets = (links: Link[]) => markdownToAdf(links.map((a) => `- [${label(a.label)}](${a.url})`).join("\n")).content;

/** The text that tells whether the Artifacts and Files sections changed: their hash is kept with the sync base. */
export const attachmentsText = (artifacts: Link[] | undefined, files: Link[] | undefined) => [...safeLinks(artifacts).map((a) => `a ${label(a.label)} ${a.url}`), ...safeLinks(files).map((a) => `f ${label(a.label)} ${a.url}`)].join("\n");
export const attachmentsHash = (artifacts: Link[] | undefined, files: Link[] | undefined) => createHash("sha256").update(attachmentsText(artifacts, files)).digest("hex");

export type ComposeInput = {
  /** Product Velocity's text of each section, as Markdown. */
  pv: Record<TextSection, string>;
  /** Sections whose existing Jira content stays as it is (Jira's own nodes win over Product Velocity's text). */
  keep?: Partial<Record<TextSection, AdfNode[]>>;
  /** What stood above our first heading in Jira. */
  head?: AdfNode[];
  artifacts?: Link[];
  files?: Link[];
};

/** The Jira description: head, then Summary, Description, Hypothesis, Artifacts, Files; a section with nothing in it is left out. */
export function composeDescription(c: ComposeInput): AdfDoc {
  const out: AdfNode[] = [...(c.head ?? [])];
  for (const [key, name] of SECTIONS) {
    if (key === "artifacts" || key === "files") {
      const links = safeLinks(key === "artifacts" ? c.artifacts : c.files);
      if (links.length > 0) out.push(heading(name), ...bullets(links));
      continue;
    }
    const kept = c.keep?.[key];
    if (kept && kept.length > 0) { out.push(heading(name), ...kept); continue; }
    if (c.keep && key in c.keep) continue; // kept, and empty
    const text = c.pv[key].trim();
    if (text) out.push(heading(name), ...markdownToAdf(text).content);
  }
  return out.length > 0 ? doc(out) : markdownToAdf("");
}
