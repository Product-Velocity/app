import { adfToMarkdown, type AdfDoc, type AdfNode } from "./adf";
import { splitDescription } from "./jira-sections";

/**
 * The text of a Jira description to keep as an initiative's Description when the issue is pulled in (issue #365, twin of
 * `descriptionFromIssueBody` for GitHub). A plain description (typed in Jira) is converted whole. A description that carries our headings
 * (written by Product Velocity before, here or in another workspace) is not skipped: its Description section is used, else its Summary,
 * else what stands above the first heading. Pure and read-only; the caller cuts the result and neutralises our markers and @mentions.
 */
export function descriptionFromJiraAdf(adf: unknown): { text: string; hadSections: boolean } {
  const asDoc = (nodes: AdfNode[] | undefined): AdfDoc => ({ type: "doc", version: 1, content: nodes ?? [] });
  const split = splitDescription(adf);
  if (split.legacy) return { text: adfToMarkdown(adf), hadSections: false };
  for (const nodes of [split.nodes.description, split.nodes.summary, split.head]) {
    const text = adfToMarkdown(asDoc(nodes));
    if (text) return { text, hadSections: true };
  }
  return { text: "", hadSections: true };
}
