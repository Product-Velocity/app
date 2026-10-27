/** The latest of the given times (ISO strings; anything that is not a date is ignored), or null. */
export function latestTime(values: readonly unknown[]): string | null {
  let best: { at: number; iso: string } | null = null;
  for (const v of values) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
    const at = Date.parse(v);
    if (!Number.isNaN(at) && (!best || at > best.at)) best = { at, iso: v };
  }
  return best?.iso ?? null;
}

/** "just now", "4 minutes ago", "3 hours ago", "2 days ago": how long before `now` an ISO time was. A time in the future reads as "just now". */
export function agoLabel(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 48) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}
