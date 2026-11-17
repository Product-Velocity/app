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
