import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DOC_KIND_LABEL } from "@pv/domain";

const STATUS: Record<string, string> = { draft: "Draft", in_review: "In review", approved: "Approved" };

/**
 * The read-only page behind the public link of a shared document (issue #325). Text is data (CLAUDE.md rule 4): raw HTML is not rendered, links open
 * in a new tab without telling the target where they came from, and images are not loaded. It names no workspace, initiative or person.
 */
export function PublicDocument({ title, kind, status, version, body, updatedAt }: { title: string; kind: string; status: string; version: number; body: string; updatedAt: string }) {
  return (
    <main className="public-doc">
      <header>
        <h1>{title}</h1>
        <p className="muted">
          {DOC_KIND_LABEL[kind as keyof typeof DOC_KIND_LABEL] ?? kind} · {STATUS[status] ?? status} · version {version} · updated {updatedAt.slice(0, 10)}
        </p>
      </header>
      <div className="md-preview" data-testid="public-document-body">
        {body.trim() ? (
          <Markdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>,
              img: ({ alt }) => <span className="muted">[image{alt ? `: ${alt}` : ""}]</span>,
            }}
          >
            {body}
          </Markdown>
        ) : <p className="muted">This document has no text yet.</p>}
      </div>
      <footer className="muted">Shared from Product Velocity. This page is read only and always shows the current version.</footer>
    </main>
  );
}
