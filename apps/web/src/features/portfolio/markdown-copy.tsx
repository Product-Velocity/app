import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownPreview } from "./markdown-preview";

/**
 * The formatted version of a document for the clipboard: the same HTML the Preview shows (raw HTML in the text is shown as text, images
 * are not loaded; CLAUDE.md rule 4), with table borders inline so a table keeps its grid when pasted into Docs, Word, Gmail or Slack.
 */
export function markdownToClipboardHtml(text: string): string {
  const html = renderToStaticMarkup(<MarkdownPreview text={text} />);
  return html
    .replace(/<table>/g, '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse">')
    .replace(/ target="_blank"| rel="noreferrer noopener"/g, "");
}

export type CopyResult = "formatted" | "text" | "failed";

/** Copies formatted text (HTML with the Markdown as the plain-text fallback). Browsers without rich copy get the Markdown only. */
export async function copyFormatted(text: string): Promise<CopyResult> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([markdownToClipboardHtml(text)], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      return "formatted";
    }
    await navigator.clipboard.writeText(text);
    return "text";
  } catch {
    return "failed";
  }
}

export async function copyMarkdown(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
