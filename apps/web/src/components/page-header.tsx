import type { ReactNode } from "react";

/**
 * The header every workspace page shares, so the area under the main tabs reads the same everywhere:
 * 1. the page name as a breadcrumb (13px bold), then its views if it has any, then its tools on the right;
 * 2. one muted 13px context line: how many items are shown, the scope, then anything page-specific;
 * 3. optional extras under that (filter chips, notices).
 * Pages never build their own page-head.
 */
export function PageHeader({ title, views, tools, count, scope, note, className, children }: {
  /** A plain name becomes the h1; pass a node (already holding an h1) to keep your own. */
  title: ReactNode;
  /** View pills or report chips; leave out when the page has none. */
  views?: ReactNode;
  tools?: ReactNode;
  /** "166 initiatives", "9 decisions waiting"; every page shows one. */
  count?: ReactNode;
  /** The project scope label; left out when it is all projects. */
  scope?: string | null;
  /** Anything else for the context line, e.g. "Week 48 · read-only". */
  note?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const parts: ReactNode[] = [count, scope ? `scope: ${scope}` : null, note].filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  return (
    <div className={`page-head${className ? ` ${className}` : ""}`}>
      <div className={views ? "head-row" : "head-row head-row-solo"}>
        {typeof title === "string" ? <h1>{title}</h1> : title}
        {views}
        {tools && <span className="head-tools">{tools}</span>}
      </div>
      {parts.length > 0 && (
        <p className="page-meta muted" role="status">
          {parts.map((p, i) => <span key={i}>{i > 0 ? " · " : ""}{p}</span>)}
        </p>
      )}
      {children}
    </div>
  );
}
