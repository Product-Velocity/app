import type { ReactNode } from "react";

/**
 * The header every workspace page shares, so the area under the main tabs reads the same everywhere:
 * 1. the page name as a breadcrumb (13px bold), then its views if it has any, then its tools on the right;
 * 2. one 13px line: the active scope and filter pills first, then how many items are shown at the back
 *    ("Project: Web · Must haves · 12 initiatives"), then anything page-specific;
 * 3. optional extras under that (notices).
 * Pages never build their own page-head.
 */
export function PageHeader({ title, views, tools, count, scope, chips, note, className, children }: {
  /** A plain name becomes the h1; pass a node (already holding an h1) to keep your own. */
  title: ReactNode;
  /** View pills or report chips; leave out when the page has none. */
  views?: ReactNode;
  tools?: ReactNode;
  /** "166 initiatives", "9 decisions waiting"; every page shows one. */
  count?: ReactNode;
  /** The project scope label; shown as a pill, left out when there is none. It is not repeated in the text. */
  scope?: string | null;
  /** Filter pills (token-chip spans), shown before the count. */
  chips?: ReactNode;
  /** Anything else for the context line, e.g. "Week 48 · read-only". */
  note?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const text: ReactNode[] = [count, note].filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  const hasPills = Boolean(scope) || Boolean(chips);
  return (
    <div className={`page-head${className ? ` ${className}` : ""}`}>
      <div className={views ? "head-row" : "head-row head-row-solo"}>
        {typeof title === "string" ? <h1>{title}</h1> : title}
        {views}
        {tools && <span className="head-tools">{tools}</span>}
      </div>
      {(hasPills || text.length > 0) && (
        <div className="page-meta">
          {hasPills && (
            <span className="page-pills" role="group" aria-label="Active scope and filters">
              {scope ? <span className="token-chip">Project: {scope}</span> : null}
              {chips}
            </span>
          )}
          {text.length > 0 && (
            <span className="muted" role="status">
              {text.map((p, i) => <span key={i}>{i > 0 ? " · " : ""}{p}</span>)}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
