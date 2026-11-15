"use client";

import type { CustomCellRendererProps } from "ag-grid-react";
import type { GridItem } from "./types";
import type { IssueInfo } from "./issue-rows";

/** What the grid hands its cells through `context` (see PortfolioGrid). */
export type NameCellContext = { toggleGroup: (key: string) => void; issueInfo?: (id: string) => IssueInfo | null };

/**
 * The Initiative Name cell while "Show issues" is on: the name, and on the right a chip that folds and unfolds this initiative's issues:
 * "▾ 7 issues · 2 To Do · 5 Done". The words carry the status; the arrow says whether the issues are shown.
 */
export function NameWithIssues(p: CustomCellRendererProps<GridItem>) {
  const ctx = p.context as NameCellContext;
  const info = p.data ? ctx.issueInfo?.(p.data.id) ?? null : null;
  return (
    <span className="name-cell">
      <span className="name-text">{String(p.value ?? "")}</span>
      {info && (
        <button
          type="button"
          className="issue-chip"
          title={`${info.count} ${info.count === 1 ? "issue" : "issues"}${info.summary ? ` · ${info.summary}` : ""}: ${info.collapsed ? "press to show them" : "press to fold them away"}`}
          aria-expanded={!info.collapsed}
          aria-label={`${info.collapsed ? "Expand" : "Collapse"} the issues of ${p.data?.item_code ?? "this initiative"}: ${info.count} ${info.count === 1 ? "issue" : "issues"}, ${info.summary}`}
          onClick={(e) => { e.stopPropagation(); ctx.toggleGroup(info.key); }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <span aria-hidden="true">{info.collapsed ? "▸" : "▾"}</span> {info.count} {info.count === 1 ? "issue" : "issues"}{info.summary ? <span className="issue-sum"> · {info.summary}</span> : null}
        </button>
      )}
    </span>
  );
}
