import { parseDate } from "./dates";
import { FIELD_BY_KEY } from "./registry";
import { nearDuplicates, resolveGroup } from "./groups";

/**
 * Quick-add: one line becomes one item. `#project @person M should` set fields, the rest is the name.
 * Everything typed is plain text; nothing here is ever treated as an instruction.
 */
export type QuickAddCtx = {
  projects: { id: string; name: string }[];
  members: { user_id: string; email: string }[];
  /** Project to use when the line has no #project (the project of the row you are on, or the last one used). */
  defaultProject?: string | null;
  /** Initiative Groups of the workspace, for `+group`. */
  groups?: string[];
  /** Today, for `start:` and `by:` dates ("friday", "31/03"). Without it those tokens are not read. */
  today?: Date;
};
export type Draft = {
  initiative_name: string;
  home_project: string;
  product_manager: string | null;
  effort: string | null;
  moscow: string | null;
  /** Initiative Group, when the line has +group. */
  theme?: string;
  /** Now, Next or Later, when the line has ~now, ~next or ~later. */
  horizon?: string;
  /** On Track, At Risk, Delayed or Blocked, when the line has !ontrack, !atrisk, !delayed or !blocked. */
  health?: string;
  /** Planned Start and G2M Date (est), as yyyy-mm-dd, when the line has start: or by:. */
  planned_start?: string;
  g2m_date_est?: string;
};

/** The tokens the line understands, for the help and the hint under the bar. Plain text only: nothing typed here is ever an instruction. */
export const QUICK_ADD_TOKENS: { token: string; means: string; important: boolean }[] = [
  { token: "#platform", means: "Project (the start of its name is enough)", important: true },
  { token: "@anna", means: "Product Manager (the start of the email name)", important: true },
  { token: "+growth", means: "Initiative Group (an unknown name creates a new group)", important: true },
  { token: "M or XL", means: "Effort, as the last word (XS, S, M, L, XL)", important: true },
  { token: "must", means: "MoSCoW, as the last word (must, should, could, won't)", important: true },
  { token: "~now", means: "Horizon: ~now, ~next or ~later", important: false },
  { token: "!atrisk", means: "Health: !ontrack, !atrisk, !delayed or !blocked", important: false },
  { token: "start:mon", means: "Planned Start: a date in your own format, or words like friday, q2", important: false },
  { token: "by:31/03", means: "G2M Date (est): same ways of typing a date", important: false },
];
export type QuickAddResult =
  | { ok: true; draft: Draft; projectInherited: boolean; /** A group that does not exist yet and will be created. */ newGroup?: string; /** Existing groups that look like the new one. */ similarGroups?: string[] }
  | { ok: false; error: string };

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
  let groupQuery: string | null = null;
  let horizonQuery: string | null = null;
  let healthQuery: string | null = null;
  let startQuery: string | null = null;
  let byQuery: string | null = null;
  const words: string[] = [];
  for (const t of tokens) {
    if (/^~[A-Za-z]+$/.test(t) && horizonQuery === null) horizonQuery = t.slice(1);
    else if (/^![A-Za-z-]+$/.test(t) && healthQuery === null) healthQuery = t.slice(1);
    else if (ctx.today && /^start:\S+$/i.test(t) && startQuery === null) startQuery = t.slice(6);
    else if (ctx.today && /^by:\S+$/i.test(t) && byQuery === null) byQuery = t.slice(3);
    else if (/^#\S+/.test(t) && projectQuery === null) projectQuery = t.slice(1);
    else if (/^@\S+/.test(t) && personQuery === null) personQuery = t.slice(1);
    else if (/^\+[A-Za-z0-9]\S*$/.test(t) && groupQuery === null) groupQuery = t.slice(1).replace(/[-_]+/g, " ");
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
  const draft: Draft = { initiative_name: name, home_project: home, product_manager: person, effort, moscow };
  if (horizonQuery !== null) {
    const r = pick((FIELD_BY_KEY.horizon?.allowed ?? []).map((v) => ({ v })), (x) => x.v, horizonQuery);
    if ("error" in r) return { ok: false, error: `Horizon is ~now, ~next or ~later (not "${horizonQuery}").` };
    draft.horizon = r.hit.v;
  }
  if (healthQuery !== null) {
    const r = pick((FIELD_BY_KEY.health?.allowed ?? []).map((v) => ({ v })), (x) => x.v, healthQuery);
    if ("error" in r) return { ok: false, error: `Health is !ontrack, !atrisk, !delayed or !blocked (not "${healthQuery}").` };
    draft.health = r.hit.v;
  }
  for (const [query, key, edge, label] of [[startQuery, "planned_start", "start", "start:"], [byQuery, "g2m_date_est", "end", "by:"]] as const) {
    if (query === null || !ctx.today) continue;
    const d = parseDate(query.replace(/[-_]+(?=[a-z])/gi, " "), ctx.today, { edge });
    if (!d.ok || !d.iso) return { ok: false, error: `${label}${query}: ${d.ok ? "that is not a date" : d.error}` };
    draft[key] = d.iso;
  }
  if (draft.planned_start && draft.g2m_date_est && draft.g2m_date_est < draft.planned_start) return { ok: false, error: "by: cannot be before start:." };
  if (groupQuery === null) return { ok: true, projectInherited: inherited, draft };
  const groups = ctx.groups ?? [];
  const exact = resolveGroup(groupQuery, groups);
  if (exact.kind === "existing") return { ok: true, projectInherited: inherited, draft: { ...draft, theme: exact.name } };
  const byStart = pick(groups, (g) => g, groupQuery);
  if ("hit" in byStart) return { ok: true, projectInherited: inherited, draft: { ...draft, theme: byStart.hit } };
  if (byStart.error === "many") return { ok: false, error: `More than one group starts with "${groupQuery}". Type more of the name.` };
  const created = groupQuery.trim();
  if (created.length > 120) return { ok: false, error: "Keep the group name under 120 characters." };
  const similar = nearDuplicates(created, groups);
  return { ok: true, projectInherited: inherited, draft: { ...draft, theme: created }, newGroup: created, ...(similar.length ? { similarGroups: similar } : {}) };
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
