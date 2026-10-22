/**
 * Initiative Group is an open list per workspace: people type a new group and it is created. These helpers keep the
 * list tidy: the same group in another case resolves to the existing spelling, and look-alikes ("On-boarding" next to
 * "Onboarding") are pointed out before a near-duplicate is created.
 */
export const MAX_GROUP_LENGTH = 120;

/** The letters and digits of a name, lower-cased: what "the same group" means when typing. */
export const groupKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export function cleanGroupName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name === "") return { ok: false, error: "Type a group name." };
  if (name.length > MAX_GROUP_LENGTH) return { ok: false, error: `Keep the group name under ${MAX_GROUP_LENGTH} characters.` };
  return { ok: true, name };
}

function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

/** Existing groups that look like `typed` (same letters, or one typo in a name of 6+ letters), but are not the same name. */
export function nearDuplicates(typed: string, existing: readonly string[]): string[] {
  const k = groupKey(typed);
  if (k === "") return [];
  return existing.filter((e) => {
    if (e.toLowerCase() === typed.trim().toLowerCase()) return false;
    const ek = groupKey(e);
    if (ek === k) return true;
    return k.length >= 6 && ek.length >= 6 && oneEditApart(k, ek);
  });
}

export type ResolvedGroup =
  | { kind: "empty" }
  | { kind: "existing"; name: string }
  | { kind: "new"; name: string; similar: string[] };

/** What typing `raw` means: nothing, an existing group (in its own spelling) or a new one, with look-alikes. */
export function resolveGroup(raw: string, existing: readonly string[]): ResolvedGroup {
  const c = cleanGroupName(raw);
  if (!c.ok) return { kind: "empty" };
  const hit = existing.find((e) => e.toLowerCase() === c.name.toLowerCase());
  if (hit) return { kind: "existing", name: hit };
  return { kind: "new", name: c.name, similar: nearDuplicates(c.name, existing) };
}

/** Groups to offer while typing: names that start with the text first, then names that contain it; A to Z. */
export function suggestGroups(query: string, existing: readonly string[]): string[] {
  const q = query.trim().toLowerCase();
  const sorted = [...existing].sort((a, b) => a.localeCompare(b, "en"));
  if (q === "") return sorted;
  const starts = sorted.filter((e) => e.toLowerCase().startsWith(q));
  const contains = sorted.filter((e) => !e.toLowerCase().startsWith(q) && (e.toLowerCase().includes(q) || groupKey(e).includes(groupKey(q)) && groupKey(q) !== ""));
  return [...starts, ...contains];
}
