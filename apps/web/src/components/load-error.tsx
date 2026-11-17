"use client";

import { useEffect, useState } from "react";
import { LOAD_ERROR_KEY, rememberLoadError, shouldReloadOnce } from "@/lib/reload-once";

/** After the automatic reload the page works, so what failed is shown once on it (and kept in the console) for whoever needs to find the cause. */
export function LoadErrorNotice() {
  const [text, setText] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  // read after the first paint, so the server and the browser first render the same (nothing)
  useEffect(() => {
    if (read) return;
    let found: string | null = null;
    try {
      found = window.sessionStorage.getItem(LOAD_ERROR_KEY);
      if (found) window.sessionStorage.removeItem(LOAD_ERROR_KEY);
    } catch { /* storage may be unavailable */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the stored text exists only in the browser
    setRead(true); if (found) setText(found);
  }, [read]);
  if (!text) return null;
  return (
    <div role="status" className="notice-box" data-testid="load-error-notice">
      <strong>A page failed to load and was loaded again.</strong> If this keeps happening, send this to support:
      <pre style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", fontSize: 12 }}>{text}</pre>
      <button type="button" className="link-button" onClick={() => setText(null)}>Dismiss</button>
    </div>
  );
}

/**
 * The screen for a page that could not load. A page that fails right after a release is fixed by loading it again, so it reloads once by itself;
 * if it fails again within the minute the person sees this screen with Reload and Back (so a page that is really broken never loops).
 */
export function LoadError({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  useEffect(() => {
    console.error("Page failed to load", error.message, error.digest ?? "");
    rememberLoadError(error);
    let store: Storage | null = null;
    try { store = window.sessionStorage; } catch { store = null; }
    if (shouldReloadOnce(store, `pv.reload.${window.location.pathname}`, Date.now())) window.location.reload();
  }, [error]);
  return (
    <div role="alert" style={{ maxWidth: 560, margin: "96px auto", padding: "0 16px", fontFamily: "inherit" }}>
      <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>This page couldn’t load</h1>
      <p className="muted">Reload to try again, or go back.{error.digest ? ` (Reference ${error.digest}.)` : ""}</p>
      <p style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn" onClick={() => window.location.reload()}>Reload</button>
        <button type="button" className="btn" onClick={() => (reset ? reset() : window.history.back())}>Try again</button>
        <button type="button" className="btn" onClick={() => window.history.back()}>Back</button>
      </p>
    </div>
  );
}
