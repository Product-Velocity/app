/**
 * Quick-add: one line becomes one item. `#project @person M should` set fields, the rest is the name.
 * Everything typed is plain text; nothing here is ever treated as an instruction.
 */
export type QuickAddCtx = {
  projects: { id: string; name: string }[];
  members: { user_id: string; email: string }[];
  /** Project to use when the line has no #project (the project of the row you are on, or the last one used). */
  defaultProject?: string | null;
};
export type Draft = {
  initiative_name: string;
  home_project: string;
  product_manager: string | null;
  effort: string | null;
  moscow: string | null;
};
export type QuickAddResult = { ok: true; draft: Draft; projectInherited: boolean } | { ok: false; error: string };

const SIZES = new Set(["XS", "S", "M", "L", "XL"]);
const MOSCOW: Record<string, string> = { must: "Must", should: "Should", could: "Could", "won't": "Won't", wont: "Won't" };
const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export const MAX_LIST = 200;

export function pick<T>(items: T[], key: (t: T) => string, query: string): { hit: T } | { error: "none" | "many" } {
  const q = letters(query);
  if (!q) return { error: "none" };
  const exact = items.filter((i) => letters(key(i)) === q);
  if (exact.length === 1) return { hit: exact[0]! };
  const prefix = items.filter((i) => letters(key(i)).startsWith(q));
  if (prefix.length === 1) return { hit: prefix[0]! };
  return { error: prefix.length === 0 ? "none" : "many" };
}

export function parseQuickAdd(input: string, ctx: QuickAddCtx): QuickAddResult {
  const tokens = input.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim().split(/\s+/).filter(Boolean);
  let projectQuery: string | null = null;
  let personQuery: string | null = null;
  const words: string[] = [];
  for (const t of tokens) {
    if (/^#\S+/.test(t) && projectQuery === null) projectQuery = t.slice(1);
    else if (/^@\S+/.test(t) && personQuery === null) personQuery = t.slice(1);
    else words.push(t);
  }
  // size and MoSCoW are read from the end of the name only
  let effort: string | null = null;
  let moscow: string | null = null;
  while (words.length > 1) {
    const last = words[words.length - 1]!;
    if (effort === null && SIZES.has(last)) effort = last;
    else if (moscow === null && MOSCOW[last.toLowerCase()]) moscow = MOSCOW[last.toLowerCase()]!;
    else break;
    words.pop();
  }
  const name = words.join(" ").trim();
  if (!name) return { ok: false, error: "Type a name." };
  if (name.length > 300) return { ok: false, error: "Keep the name under 300 characters." };

  let home: string | null = null;
  let inherited = false;
  if (projectQuery !== null) {
    const r = pick(ctx.projects, (p) => p.name, projectQuery);
    if ("error" in r) {
      return { ok: false, error: r.error === "many" ? `More than one project starts with "${projectQuery}". Type more of the name.` : `No project named "${projectQuery}".` };
    }
    home = r.hit.id;
  } else if (ctx.defaultProject && ctx.projects.some((p) => p.id === ctx.defaultProject)) {
    home = ctx.defaultProject;
    inherited = true;
  } else if (ctx.projects.length === 1) {
    home = ctx.projects[0]!.id;
    inherited = true;
  }
  if (!home) return { ok: false, error: "Choose a project with #name (for example #platform)." };

  let person: string | null = null;
  if (personQuery !== null) {
    const r = pick(ctx.members, (m) => m.email.split("@")[0]!, personQuery);
    if ("error" in r) {
      return { ok: false, error: r.error === "many" ? `More than one person starts with "${personQuery}". Type more of the name.` : `No person named "${personQuery}".` };
    }
    person = r.hit.user_id;
  }
  return { ok: true, projectInherited: inherited, draft: { initiative_name: name, home_project: home, product_manager: person, effort, moscow } };
}

export type ListRow = ({ ok: true; draft: Draft; projectInherited: boolean } | { ok: false; error: string }) & { line: number; text: string };

/** Pasted text: one item per non-empty line, at most 200. */
export function parseQuickAddList(text: string, ctx: QuickAddCtx): ListRow[] {
  const out: ListRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === "" || out.length >= MAX_LIST) return;
    out.push({ ...parseQuickAdd(raw, ctx), line: i + 1, text: raw.trim() });
  });
  return out;
}

const STOP = new Set(["the", "and", "for", "with", "from", "into", "that", "this", "new", "add", "get", "our", "your"]);
const words = (s: string) => [...new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))];

/** Items whose names look like what is being typed (shown as a hint, never blocks). */
export function similarItems<T extends { id: string; item_code: string; initiative_name: string }>(name: string, items: T[], limit = 3): T[] {
  const a = words(name);
  if (a.length === 0 || name.trim().length < 3) return [];
  const norm = letters(name);
  return items
    .map((it) => {
      const b = words(it.initiative_name);
      const shared = a.filter((w) => b.includes(w)).length;
      const nb = letters(it.initiative_name);
      const contains = norm.length >= 6 && (nb.includes(norm) || norm.includes(nb));
      const score = norm === nb ? 2 : contains ? 1.5 : shared >= 2 || (shared === 1 && a.length === 1 && b.length === 1) ? shared / Math.max(a.length, b.length) : 0;
      return { it, score: score >= 0.5 ? score : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.it);
}
