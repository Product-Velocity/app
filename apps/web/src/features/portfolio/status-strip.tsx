"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PortfolioController } from "./controller";

function ago(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  return m === 1 ? "1 minute ago" : `${m} minutes ago`;
}

export function useStatus(c: PortfolioController) {
  useSyncExternalStore(
    (cb) => c.subscribe(() => cb()),
    () => c.status.version,
    () => 0,
  );
  return c.status;
}

/** The saved/undo line. `tools` (Filters, Columns, Export) sit on the same line, between the saved text and Undo/Redo. */
export function StatusStrip({ controller, tools }: { controller: PortfolioController; tools?: ReactNode }) {
  const status = useStatus(controller);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? "⌘" : "Ctrl+";
  const saving = status.pending > 0;

  return (
    <div className="strip">
      <div className="strip-main">
        {!controller.canEdit ? (
          <span className="strip-note">View-only: you can look but not change the roadmap.</span>
        ) : saving ? (
          <span className="strip-saving" role="status">Saving…</span>
        ) : status.error ? (
          <span className="strip-error">✖ Not all changes could be saved</span>
        ) : (
          <span className="strip-ok" role="status">✓ All changes saved</span>
        )}
        {status.last && <span className="strip-last">Last: {status.last.text}, {ago(status.last.at, now)}</span>}
      </div>
      {tools && <div className="strip-tools">{tools}</div>}
      {controller.canEdit && (
        <div className="strip-actions">
          <button type="button" className="btn" disabled={!status.canUndo} onClick={() => void controller.undo()}>
            Undo {mod}Z
          </button>
          <button type="button" className="btn" disabled={!status.canRedo} onClick={() => void controller.redo()}>
            Redo {mac ? "⇧⌘Z" : "Ctrl+Y"}
          </button>
        </div>
      )}
      {status.error && (
        <p role="alert" className="strip-alert">
          {status.error}{" "}
          <button type="button" className="link-button" onClick={() => controller.dismissError()}>Dismiss</button>
        </p>
      )}
      {status.notice && <p role="status" className="strip-notice">{status.notice}</p>}
    </div>
  );
}

/** "All changes saved" and Undo / Redo for the bar above the grid: one short line of text and two icon buttons. */
export function StatusInline({ controller }: { controller: PortfolioController }) {
  const status = useStatus(controller);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? "⌘" : "Ctrl+";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  return (
    <>
      <span className="pvbar-last">{status.last ? `Last: ${status.last.text}, ${ago(status.last.at, now)}` : ""}</span>
      {!controller.canEdit ? (
        <span className="pvbar-status strip-note">View-only</span>
      ) : status.pending > 0 ? (
        <span className="pvbar-status strip-saving" role="status">Saving…</span>
      ) : status.error ? (
        <span className="pvbar-status strip-error">✖ Not all saved</span>
      ) : (
        <span className="pvbar-status" role="status" title={status.last ? `Last: ${status.last.text}` : undefined}><span className="strip-ok">✓ All changes saved</span></span>
      )}
      {controller.canEdit && (
        <>
          <button type="button" className="btn pvbar-undo" aria-label={`Undo (${mod}Z)`} title={`Undo ${mod}Z`} disabled={!status.canUndo} onClick={() => void controller.undo()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
          </button>
          <button type="button" className="btn pvbar-undo" aria-label={`Redo (${mac ? "⇧⌘Z" : "Ctrl+Y"})`} title={`Redo ${mac ? "⇧⌘Z" : "Ctrl+Y"}`} disabled={!status.canRedo} onClick={() => void controller.redo()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
          </button>
        </>
      )}
    </>
  );
}

/** Save errors and notices, under the first line of the bar. */
export function StatusAlerts({ controller }: { controller: PortfolioController }) {
  const status = useStatus(controller);
  if (!status.error && !status.notice) return null;
  return (
    <div className="pvbar-alerts">
      {status.error && (
        <p role="alert" className="strip-alert">
          {status.error}{" "}
          <button type="button" className="link-button" onClick={() => controller.dismissError()}>Dismiss</button>
        </p>
      )}
      {status.notice && <p role="status" className="strip-notice">{status.notice}</p>}
    </div>
  );
}
