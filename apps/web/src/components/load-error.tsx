"use client";

import { useEffect } from "react";
import { shouldReloadOnce } from "@/lib/reload-once";

/**
 * The screen for a page that could not load. A page that fails right after a release is fixed by loading it again, so it reloads once by itself;
 * if it fails again within the minute the person sees this screen with Reload and Back (so a page that is really broken never loops).
 */
export function LoadError({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  useEffect(() => {
    console.error("Page failed to load", error.message, error.digest ?? "");
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
