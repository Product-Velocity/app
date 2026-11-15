// Epic keys typed or pasted by a person (issue #431): "R8P-5, DATA-9", one per line, or Jira links. Pure, so it is tested without a screen.
const KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;
export const MAX_EPIC_KEYS = 50;

/** The keys in a pasted text (a link to an issue gives its key), upper-cased and without repeats, and the pieces that are not a key. */
export function parseEpicKeys(text: string): { keys: string[]; invalid: string[] } {
  const keys: string[] = [];
  const invalid: string[] = [];
  for (const piece of text.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean)) {
    const m = piece.match(/([A-Za-z][A-Za-z0-9_]{1,19}-[0-9]{1,9})(?:[/?#].*)?$/);
    const key = m ? m[1]!.toUpperCase() : "";
    if (KEY.test(key)) { if (!keys.includes(key)) keys.push(key); } else if (!invalid.includes(piece.slice(0, 40))) invalid.push(piece.slice(0, 40));
  }
  return { keys, invalid };
}
