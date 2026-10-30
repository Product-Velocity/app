// Assistant memory (docs/27-AI-ASSISTANTS-AND-MEMORY.md): short, sourced notes that an AI assistant saves while it works and finds again in the next
// session, whichever assistant that is. It is NOT a place for instructions, secrets, people's answers or commercial values, and it never reaches
// GitHub. Pure: no database, no tool code.

export const MEMORY_KINDS = [
  { key: "fact", title: "Fact", covers: "Something that holds beyond one initiative: how the company, a product or a market works." },
  { key: "term", title: "Term", covers: "A word, acronym or product name and what it means here." },
  { key: "partner", title: "Partner", covers: "A third party (partner, vendor, platform): what it publicly offers, as it states it." },
  { key: "research", title: "Research", covers: "What was found when a question was researched, with the sources and the date." },
  { key: "preference", title: "Preference", covers: "How this team likes its documents, names and structure written." },
  { key: "lesson", title: "Lesson", covers: "What a review, a launch or an earlier initiative taught that the next one should reuse." },
  { key: "open_question", title: "Open question", covers: "A question nobody could answer yet, so the next session does not ask the same thing blindly." },
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number]["key"];
export const MEMORY_KIND_KEYS: readonly string[] = MEMORY_KINDS.map((k) => k.key);

/** workspace: the whole company. group: one Initiative Group. item: one initiative. */
export const MEMORY_SCOPES = ["workspace", "group", "item"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

/** Where the statement comes from. person: the signed-in person said it (their words go in source). source: a web page or file the assistant read. document: a document or initiative in the workspace. */
export const MEMORY_BASES = ["person", "source", "document"] as const;
export type MemoryBasis = (typeof MEMORY_BASES)[number];

export type MemoryStatus = "draft" | "confirmed" | "archived";

export const MEMORY_TITLE_MAX = 120;
export const MEMORY_BODY_MAX = 2000;
export const MEMORY_SOURCE_MAX = 300;
export const MEMORY_TAGS_MAX = 8;
export const MEMORY_TAG_MAX = 40;
/** The most active notes a workspace keeps; the database refuses more, so a recall can always load them all. */
export const MEMORY_WORKSPACE_CAP = 1000;
/** A partner, research or fact note older than this is shown as stale and checked again before it is relied on (the same 90 days as the company profile). */
export const MEMORY_STALE_DAYS = 90;
export const MEMORY_RECALL_DEFAULT = 8;
export const MEMORY_RECALL_MAX = 25;

export type MemoryInput = {
  scope: MemoryScope;
  /** Initiative Group name (scope group). */
  group: string | null;
  /** Initiative code such as R-12 (scope item). */
  item: string | null;
  kind: MemoryKind;
  title: string;
  body: string;
  source: string;
  basis: MemoryBasis;
  tags: string[];
};

/** A note as stored, with the group name and item code instead of ids. */
export type MemoryRow = {
  id: string;
  scope: MemoryScope;
  group: string | null;
  item: string | null;
  kind: MemoryKind;
  title: string;
  body: string;
  source: string;
  basis: MemoryBasis;
  tags: string[];
  status: MemoryStatus;
  ai_draft: boolean;
  version: number;
  /** When the content was last checked against its source; set when the note is saved. */
  verified_at: string;
  updated_at: string;
  /** Which assistant wrote it (claude, chatgpt, gemini, other), or null when a person wrote it in the app. */
  assistant: string | null;
};

// Things that must never be stored as a note. Notes are replayed into later sessions of any assistant, so a secret or an order saved once
// would be read again and again.
const SECRET = /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|xox[baprs]-[A-Za-z0-9-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(password|passwd|api[_ -]?key|secret|bearer)\s*[:=]\s*\S{6,}/i;
const ORDER = /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|above|prior|earlier|all|any|the)\b[^.\n]{0,40}\b(instructions?|rules?|prompts?|messages?)\b|\b(system|developer) (prompt|message)\b|\byou (must|should|will) (always|never|now)\b|\bfrom now on,? (you|always|never)\b|\bact as (an? |the )?(system|assistant|admin|administrator|root|developer)\b|\b(confirm_(changes|github_push)|update_items|create_items)\b/i;
// Participant privacy (rule 7): notes never hold who voted what.
const VOTER = /\b(voter|participant|respondent)s?\b[^.\n]{0,60}\b(voted|answered|said|scored|rated)\b/i;

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+\n/g, "\n").trim() : "");

/** Why a note is refused, or null when its text is fine. Shared by the tool and the Memory page. */
export function memoryTextProblem(text: string): string | null {
  if (SECRET.test(text)) return "That looks like a secret (a key, token or password). Notes are read back in later sessions, so secrets are never saved. Leave it out.";
  if (ORDER.test(text)) return "Notes hold facts, not instructions to an assistant (for example \"ignore the rules\" or \"approve this\"). Rewrite it as a fact with its source, or leave it out.";
  if (VOTER.test(text)) return "Notes never hold what an individual participant answered or voted: alignment results stay anonymous. Leave it out.";
  return null;
}

/** Checks what an assistant (or a person) wants to save. Strict about the source: a note without one is a guess. */
export function checkMemoryInput(a: Record<string, unknown>): { ok: true; value: MemoryInput } | { ok: false; error: string } {
  const kind = clean(a.kind);
  if (!MEMORY_KIND_KEYS.includes(kind)) return { ok: false, error: `kind must be one of: ${MEMORY_KIND_KEYS.join(", ")}.` };
  const scope = clean(a.scope) || "workspace";
  if (!(MEMORY_SCOPES as readonly string[]).includes(scope)) return { ok: false, error: `scope must be one of: ${MEMORY_SCOPES.join(", ")}.` };
  const group = clean(a.group) || null;
  const item = clean(a.item) || null;
  if (scope === "group" && !group) return { ok: false, error: "scope group needs group: the Initiative Group name." };
  if (scope === "item" && !item) return { ok: false, error: "scope item needs item: the initiative code, such as R-12." };
  if (scope !== "group" && group) return { ok: false, error: "Leave group out unless scope is group." };
  if (scope !== "item" && item) return { ok: false, error: "Leave item out unless scope is item." };
  const title = clean(a.title);
  if (title === "") return { ok: false, error: "A note needs a title: a few words that say what it is about." };
  if (title.length > MEMORY_TITLE_MAX) return { ok: false, error: `The title is ${title.length} characters; the most is ${MEMORY_TITLE_MAX}.` };
  const body = clean(a.body);
  if (body === "") return { ok: false, error: "A note needs a body: the fact itself, in a sentence or a few lines." };
  if (body.length > MEMORY_BODY_MAX) return { ok: false, error: `The body is ${body.length.toLocaleString("en")} characters; the most is ${MEMORY_BODY_MAX.toLocaleString("en")}. Save the essence and keep the long text in a document.` };
  const basis = clean(a.basis);
  if (!(MEMORY_BASES as readonly string[]).includes(basis)) return { ok: false, error: `basis must be one of: ${MEMORY_BASES.join(", ")}. person = the person told you; source = a page or file you read; document = a document in the workspace.` };
  const source = clean(a.source);
  if (source === "") return { ok: false, error: "A note needs its source: the person's own words (basis person), the URL and the date you read it (basis source), or the initiative code and document title (basis document). Without a source it is a guess, and guesses are not saved." };
  if (source.length > MEMORY_SOURCE_MAX) return { ok: false, error: `The source is ${source.length} characters; the most is ${MEMORY_SOURCE_MAX}.` };
  const rawTags = Array.isArray(a.tags) ? a.tags : a.tags === undefined ? [] : null;
  if (!rawTags || rawTags.some((t) => typeof t !== "string")) return { ok: false, error: "tags must be a list of short words." };
  const tags = [...new Set((rawTags as string[]).map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (tags.length > MEMORY_TAGS_MAX) return { ok: false, error: `At most ${MEMORY_TAGS_MAX} tags.` };
  if (tags.some((t) => t.length > MEMORY_TAG_MAX)) return { ok: false, error: `A tag is at most ${MEMORY_TAG_MAX} characters.` };
  const problem = memoryTextProblem(`${title}\n${body}\n${source}\n${tags.join(" ")}`);
  if (problem) return { ok: false, error: problem };
  return { ok: true, value: { scope: scope as MemoryScope, group, item, kind: kind as MemoryKind, title, body, source, basis: basis as MemoryBasis, tags } };
}

export const daysBetween = (fromIso: string, now: Date): number => Math.floor((now.getTime() - Date.parse(fromIso)) / 86_400_000);

/** Partner, research and fact notes go out of date; a term, preference, lesson or question does not by itself. */
export const memoryGoesStale = (kind: string): boolean => kind === "partner" || kind === "research" || kind === "fact";
export const memoryIsStale = (m: Pick<MemoryRow, "kind" | "verified_at">, now: Date): boolean => memoryGoesStale(m.kind) && daysBetween(m.verified_at, now) > MEMORY_STALE_DAYS;

const STOP = new Set("a an and are as at be by for from has have in is it its of on or that the this to was were will with we our you your their they them not but if then than so do does did can could should would about into over under after before who what which when where how why".split(" "));
/** Lower-case words without accents, minus filler: what two texts have in common when they talk about the same thing. */
export const significantWords = (s: string): string[] =>
  [...new Set(s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w)))];

export type RecallQuery = { query?: string; group?: string | null; item?: string | null; kinds?: readonly string[]; limit?: number; includeArchived?: boolean };
export type RecalledMemory = MemoryRow & { stale: boolean; match: string[] };

/**
 * The notes that matter for a piece of work, best first. A note is considered when it is in reach (the whole workspace, this group, this
 * initiative) and, if words were given, shares at least one with it. Closer scope, a title match, a person's confirmation and freshness rank higher;
 * archived notes never appear unless asked for. Nothing is invented here: the score only orders what exists.
 */
export function recallMemories(all: readonly MemoryRow[], q: RecallQuery, now: Date): RecalledMemory[] {
  const words = significantWords(q.query ?? "");
  const group = q.group?.trim().toLowerCase() ?? null;
  const item = q.item?.trim().toLowerCase() ?? null;
  const kinds = q.kinds && q.kinds.length > 0 ? new Set(q.kinds) : null;
  const limit = Math.min(Math.max(q.limit ?? MEMORY_RECALL_DEFAULT, 1), MEMORY_RECALL_MAX);
  const out: { m: RecalledMemory; score: number }[] = [];
  for (const m of all) {
    if (m.status === "archived" && !q.includeArchived) continue;
    if (kinds && !kinds.has(m.kind)) continue;
    let reach = 1;
    if (m.scope === "group") {
      if (!group || m.group?.toLowerCase() !== group) continue;
      reach = 3;
    } else if (m.scope === "item") {
      if (!item || m.item?.toLowerCase() !== item) continue;
      reach = 4;
    }
    const title = new Set(significantWords(`${m.title} ${m.tags.join(" ")}`));
    const rest = new Set(significantWords(`${m.body} ${m.source}`));
    const hitTitle = words.filter((w) => title.has(w));
    const hitRest = words.filter((w) => !title.has(w) && rest.has(w));
    // words were given, so a note that shares none is not about this; with no words, everything in reach is offered by scope alone
    if (words.length > 0 && hitTitle.length + hitRest.length === 0 && reach === 1) continue;
    const stale = memoryIsStale(m, now);
    const score = reach * 2 + hitTitle.length * 3 + hitRest.length + (m.status === "confirmed" ? 2 : 0) - (stale ? 2 : 0) - Math.min(daysBetween(m.updated_at, now) / 365, 1);
    out.push({ m: { ...m, stale, match: [...hitTitle, ...hitRest] }, score });
  }
  return out.sort((a, b) => b.score - a.score || Date.parse(b.m.updated_at) - Date.parse(a.m.updated_at)).slice(0, limit).map((x) => x.m);
}

/** How the notes are summarised in the workspace context: counts only, so the first call stays small. */
export function summarizeMemory(all: readonly MemoryRow[], now: Date): { total: number; by_kind: Record<string, number>; stale: number; unconfirmed: number } {
  const live = all.filter((m) => m.status !== "archived");
  const by_kind: Record<string, number> = {};
  for (const m of live) by_kind[m.kind] = (by_kind[m.kind] ?? 0) + 1;
  return { total: live.length, by_kind, stale: live.filter((m) => memoryIsStale(m, now)).length, unconfirmed: live.filter((m) => m.status === "draft").length };
}
