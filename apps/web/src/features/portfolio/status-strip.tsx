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
