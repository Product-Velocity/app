"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shows Markdown the way it will read in the tracker. Text is data (CLAUDE.md rule 4): raw HTML is not rendered, only shown
 * as text; links open in a new tab; images are not loaded (a link to a stranger's server would tell them who read it).
 */
export function MarkdownPreview({ text }: { text: string }) {
  if (!text.trim()) return <p className="muted">Nothing to preview yet.</p>;
  return (
    <div className="md-preview" data-testid="markdown-preview">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
          img: ({ alt }) => <span className="muted">[image{alt ? `: ${alt}` : ""}]</span>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
