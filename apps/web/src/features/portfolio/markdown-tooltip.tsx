"use client";

import type { ITooltipParams } from "ag-grid-community";
import { MarkdownPreview } from "./markdown-preview";

/** Hover card for a Markdown cell: the whole text, rendered the way the panel and the tracker show it. Never raw HTML. */
export function MarkdownTooltip(p: ITooltipParams) {
  const text = typeof p.value === "string" ? p.value : "";
  if (!text.trim()) return null;
  return (
    <div className="md-tooltip" data-testid="markdown-tooltip">
      <MarkdownPreview text={text} />
    </div>
  );
}
