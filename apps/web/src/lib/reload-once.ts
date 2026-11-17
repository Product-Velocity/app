/**
 * A page that fails to load right after a new release (the open tab still holds the old build, or a login refresh raced another request) is fixed by loading it again.
 * The error screens call this: it asks for ONE automatic reload per address and minute, then leaves the person with the Reload button, so a page that is really broken
 * never reloads in a loop. The browser's session storage may be unavailable, so every access is guarded.
 */
export const RELOAD_WINDOW_MS = 60_000;

export function shouldReloadOnce(store: Pick<Storage, "getItem" | "setItem"> | null, key: string, now: number): boolean {
  try {
    const last = Number(store?.getItem(key) ?? 0);
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS) return false;
    store?.setItem(key, String(now));
    return store !== null;
  } catch {
    return false;
  }
}

export const LOAD_ERROR_KEY = "pv.lastLoadError";

/** What failed, in words, for the notice shown after the reload: the message, the reference and the first lines of the stack, from where the page was. No page content or data. */
export function describeLoadError(error: { message?: string; digest?: string; stack?: string }, path: string, now: Date): string {
  const lines = [`${now.toISOString()} ${path}`, `${error.message ?? "unknown error"}${error.digest ? ` (reference ${error.digest})` : ""}`];
  if (error.stack) lines.push(...error.stack.split("\n").slice(1, 6).map((l) => l.trim().slice(0, 160)));
  return lines.join("\n").slice(0, 900);
}

export function rememberLoadError(error: { message?: string; digest?: string; stack?: string }): void {
  try { window.sessionStorage.setItem(LOAD_ERROR_KEY, describeLoadError(error, window.location.pathname, new Date())); } catch { /* storage may be unavailable */ }
}
