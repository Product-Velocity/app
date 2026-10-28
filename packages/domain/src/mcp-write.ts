// What Claude may write through the MCP server (docs/20-CLAUDE-MCP.md FR-4): turn the arguments of create_items and update_items
// into database values, or into a sentence that tells Claude what to fix. Pure: no database here, the web app fetches and applies.
// The database repeats the hard rules (migration 0045 and 0008); this is the first check and the one that explains.

import { EDITABLE_FIELDS, canBeEmpty, canEditItems, readOnlyReason, validateEdit } from "./fields";
import { cleanGroupName, resolveGroup } from "./groups";
import { CLAUDE_BASIS_FIELDS, CLAUDE_FORBIDDEN_FIELDS, CLAUDE_LIST_FIELDS, claudeMaySet } from "./mcp-read";
import { cleanRelated, type Link } from "./related";
import { FIELD_BY_KEY, columnOnItems, isOpenList } from "./registry";

export const MAX_WRITE_BATCH = 50;
/** A diff from update_items can be confirmed for this long. */
export const DIFF_TTL_MINUTES = 10;

/** Keys that name the item in the tool arguments instead of the dictionary key (the dictionary keys are not offered for these). */
const ALIASES: Record<string, string> = { name: "initiative_name", initiative_name: "initiative_name", project: "home_project", home_project: "home_project", group: "theme", theme: "theme" };
const TOP_LEVEL = new Set(["initiative_name", "home_project", "theme"]);

/** Keys of the single-value fields offered next to name, project and group. Stack Rank, Decision, Value and the rest of the forbidden list are not here. */
export const WRITE_SCALAR_KEYS: readonly string[] = EDITABLE_FIELDS.filter((k) => claudeMaySet(k, "creator") && !TOP_LEVEL.has(k));

/** Words that mean an approval, which is not a dictionary field but must still be refused in plain words. */
const APPROVAL_WORDS = new Set(["approver", "is_approver", "approve", "approved", "approval", "ready_for_build", "ready for build", "readyforbuild"]);

const FORBIDDEN_NOTE = "Only a person can set it: Claude never sets Stack Rank, Decision, Value or the fields around them (Business Value Type is the one exception, and only with the person's own words as value_type_basis), never approves, and never marks work ready for build.";

/** The key that carries the person's own words next to a field Claude may set only with a basis (Business Value Type). */
export const BASIS_KEY = "value_type_basis";
export const MIN_BASIS = 8;
export const MAX_BASIS = 500;
const BASIS_HELP = `${BASIS_KEY}: the person's own words that say which Business Value Type it is (their answer or their sentence), at least a short sentence. Never your own inference: if the person has not said it, leave Business Value Type empty and ask them.`;

/** The basis Claude sent, trimmed, or a sentence saying what is wrong with it. */
function cleanBasis(raw: unknown): { ok: true; basis: string } | { ok: false; error: string } {
  const b = typeof raw === "string" ? raw.trim() : "";
  if (b.length < MIN_BASIS) return { ok: false, error: `Business Value Type needs ${BASIS_HELP}` };
  if (b.length > MAX_BASIS) return { ok: false, error: `${BASIS_KEY} is longer than ${MAX_BASIS} characters; quote the sentence that says it.` };
  return { ok: true, basis: b };
}

/** The refusal for a field Claude may never set, or null for any other field. */
export function forbiddenMessage(key: string): string | null {
  const k = key.trim().toLowerCase();
  if (!CLAUDE_FORBIDDEN_FIELDS.includes(key) && !APPROVAL_WORDS.has(k)) return null;
  const label = FIELD_BY_KEY[key]?.name ?? key;
  return `${label}: ${FORBIDDEN_NOTE}`;
}

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
/** The one place that decides whether a change to an existing value needs the person's confirmation (PRD open question 3: a filled field does, an empty one does not). */
export const requiresConfirmation = (current: unknown): boolean => !isEmpty(current);

export type WriteCtx = {
  role: string;
  projects: { id: string; name: string }[];
  /** `name` is the email address. */
  members: { id: string; name: string }[];
  groups: string[];
  teams: { id: string; name: string }[];
  items: { id: string; code: string }[];
  /** The values in use of the open-list fields (Focus Area, Audience), so a new spelling of an existing value uses the existing one (issue #246). */
  openLists?: Record<string, string[]>;
  today?: Date;
};
export type ListOp = { op: "list_add" | "list_remove"; field: string; value: unknown };
type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const quote = (xs: readonly string[], max = 12) => (xs.length > max ? `${xs.slice(0, max).join(", ")}, …` : xs.join(", "));
const READ_ONLY_ROLE = "Your role in this workspace is read-only, so Claude cannot make changes here. Ask a workspace admin for the Creator role.";

/** yyyy-mm-dd of a real calendar day, or null. Claude always sends ISO dates; the person's own format is for display only. */
export function isoDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return null;
  const s = v.trim();
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

export function cleanLink(raw: unknown): { ok: true; link: Link } | Fail {
  if (!raw || typeof raw !== "object") return fail('A link is an object with a label and an url, for example {"label": "PRD", "url": "https://..."}.');
  const l = raw as Record<string, unknown>;
  const url = typeof l.url === "string" ? l.url.trim() : "";
  const label = typeof l.label === "string" ? l.label.trim() : "";
  const r = cleanRelated("artifacts", [{ label, url }], { itemId: "", itemIds: [], teamIds: [] });
  if (!r.ok) return fail(r.error);
  if (r.value.length === 0) return fail("A link needs an url.");
  return { ok: true, link: r.value[0] as Link };
}

const norm = (s: string) => s.trim().toLowerCase();
const codeOf = (s: unknown) => (typeof s === "string" ? norm(s) : "");
/** Resolves two initiative codes to ids for a relation. */
export function cleanRelation(from: unknown, to: unknown, items: readonly { id: string; code: string }[]): { ok: true; from: string; to: string } | Fail {
  const a = items.find((i) => norm(i.code) === codeOf(from));
  const b = items.find((i) => norm(i.code) === codeOf(to));
  if (!a) return fail(`No initiative ${String(from)} in this workspace.`);
  if (!b) return fail(`No initiative ${String(to)} in this workspace.`);
  if (a.id === b.id) return fail("An initiative cannot refer to itself.");
  return { ok: true, from: a.id, to: b.id };
}

type Scalar = { ok: true; column: string; value: unknown; display: unknown; /** A hint for Claude to pass on, such as a look-alike of an existing value. */ note?: string } | Fail;

function resolveMember(raw: string, ctx: WriteCtx): { ok: true; id: string; name: string } | Fail {
  const s = norm(raw);
  const byId = ctx.members.find((m) => m.id === raw.trim());
  if (byId) return { ok: true, id: byId.id, name: byId.name };
  const byEmail = ctx.members.find((m) => norm(m.name) === s);
  if (byEmail) return { ok: true, id: byEmail.id, name: byEmail.name };
  const local = ctx.members.filter((m) => norm(m.name.split("@")[0]!) === s);
  if (local.length === 1) return { ok: true, id: local[0]!.id, name: local[0]!.name };
  return fail(local.length > 1 ? `More than one member is called "${raw}"; use the full email address.` : `No member "${raw}". Members: ${quote(ctx.members.map((m) => m.name))}.`);
}

function resolveProject(raw: string, ctx: WriteCtx): { ok: true; id: string; name: string } | Fail {
  const s = norm(raw);
  const hit = ctx.projects.find((p) => p.id === raw.trim()) ?? ctx.projects.find((p) => norm(p.name) === s);
  return hit ? { ok: true, id: hit.id, name: hit.name } : fail(`No project called "${raw}". Projects: ${quote(ctx.projects.map((p) => p.name))}.`);
}

/** Why a key cannot be written by Claude, or null when it can (a single value or a list field). */
function whyNot(key: string): string | null {
  if (key === BASIS_KEY) return null; // checked together with value_type
  const forbidden = forbiddenMessage(key);
  if (forbidden) return forbidden;
  const f = FIELD_BY_KEY[key];
  if (!f) return `Unknown field "${key}". Call describe_fields for the fields and their keys.`;
  if (CLAUDE_LIST_FIELDS.includes(key) || key === "initiative_name" || key === "home_project" || key === "theme") return null;
  if (f.mode !== "editable" || !f.editable) return readOnlyReason(key) ?? `${f.name} (${key}) cannot be set through Claude.`;
  if (!claudeMaySet(key, "creator")) return !f.editable || f.phase > 1 ? readOnlyReason(key) : `${f.name} (${key}) cannot be set through Claude yet: it needs the app's panel.`;
  return null;
}

/** One single-value field: what Claude sent becomes the database value, or a sentence naming the field and what is allowed. */
function coerce(key: string, raw: unknown, ctx: WriteCtx): Scalar {
  const f = FIELD_BY_KEY[key]!;
  const column = columnOnItems(f) ?? key;
  const nameOf = `${f.name} (${key})`;
  if (raw === null || raw === "" || raw === undefined) {
    return canBeEmpty(key) ? { ok: true, column, value: null, display: null } : fail(`${nameOf} cannot be empty.`);
  }
  if (typeof raw === "object") return fail(`${nameOf} takes one value: text, a number, true or false.`);
  if (f.type === "Date") {
    const d = isoDate(raw);
    return d ? { ok: true, column, value: d, display: d } : fail(`${nameOf}: use a date as yyyy-mm-dd, for example 2027-03-31.`);
  }
  if (f.type === "Person") {
    const m = resolveMember(String(raw), ctx);
    return m.ok ? { ok: true, column, value: m.id, display: m.name } : fail(`${nameOf}: ${m.error}`);
  }
  const text = typeof raw === "boolean" ? (raw ? "Yes" : "No") : String(raw);
  const v = validateEdit(key, text, { today: ctx.today });
  if (!v.ok) {
    if (f.type === "Select" && f.allowed.length > 0 && key !== "g2m_quarter") return fail(`${nameOf}: "${text}" is not one of ${f.allowed.join(", ")}.`);
    return fail(`${nameOf}: ${v.error}`);
  }
  if (isOpenList(key) && typeof v.value === "string") {
    // an open list: the same value in another case is the existing spelling; a new one that looks like an existing one is pointed out
    const r = resolveGroup(v.value, ctx.openLists?.[key] ?? []);
    if (r.kind === "existing") return { ok: true, column, value: r.name, display: r.name };
    if (r.kind === "new" && r.similar.length > 0) {
      return { ok: true, column, value: r.name, display: r.name, note: `${f.name} "${r.name}" is new. Did you mean ${r.similar.map((s) => `"${s}"`).join(" or ")}? Say so and I will change it.` };
    }
  }
  return { ok: true, column, value: v.value, display: v.value };
}

const ESTIMATE_KEYS = ["effort", "estimate_low_weeks", "estimate_high_weeks"];

/**
 * Warnings for fields a later stage will ask for. The app has no required-by-stage rules yet (they arrive with #101, "move to
 * next phase"), so there is nothing to report; the seam is here so the day they exist Claude is told, and never blocked at creation.
 */
export function stageWarnings(_values: Record<string, unknown>): string[] {
  return [];
}

export type GroupNote = { name: string; created: boolean; similar: string[] };
export type PreparedItem =
  | { ok: true; row: Record<string, unknown>; values: Record<string, unknown>; lists: ListOp[]; group: GroupNote | null; warnings: string[]; /** The person's own words behind Business Value Type, when it is set. */ basis?: string }
  | Fail;

/** Reads a list field's argument into the values the tables hold: tags as text, teams as ids, links as {label, url}, relations as ids. */
function listValues(field: string, raw: unknown, ctx: WriteCtx, selfId = ""): { ok: true; values: unknown[]; display: unknown[] } | Fail {
  if (!Array.isArray(raw)) return fail(`${field} takes a list.`);
  const arr = raw as unknown[];
  switch (field) {
    case "artifacts": {
      const out: Link[] = [];
      for (const x of arr) {
        const c = cleanLink(x);
        if (!c.ok) return fail(`${field}: ${c.error}`);
        out.push(c.link);
      }
      return { ok: true, values: out, display: out };
    }
    case "depends_on": case "related_to": {
      const ids: string[] = [];
      for (const x of arr) {
        const hit = ctx.items.find((i) => norm(i.code) === codeOf(x) || i.id === x);
        if (!hit) return fail(`${field}: no initiative ${String(x)} in this workspace. Use the code, such as R-12.`);
        if (hit.id === selfId) return fail(`${field}: an initiative cannot refer to itself.`);
        if (!ids.includes(hit.id)) ids.push(hit.id);
      }
      return { ok: true, values: ids, display: ids.map((i) => ctx.items.find((x) => x.id === i)!.code) };
    }
    case "contributing_teams": {
      const ids: string[] = [];
      for (const x of arr) {
        const hit = ctx.teams.find((t) => norm(t.name) === norm(String(x)) || t.id === x);
        if (!hit) return fail(`${field}: no team called "${String(x)}". Teams: ${quote(ctx.teams.map((t) => t.name))}.`);
        if (!ids.includes(hit.id)) ids.push(hit.id);
      }
      return { ok: true, values: ids, display: ids.map((i) => ctx.teams.find((t) => t.id === i)!.name) };
    }
    default: {
      const r = cleanRelated(field as never, arr, { itemId: "", itemIds: [], teamIds: [] });
      return r.ok ? { ok: true, values: r.value, display: r.value } : fail(`${field}: ${r.error}`);
    }
  }
}

/** Validates one item of create_items. Never throws: an item that cannot be created comes back as an error sentence. */
export function prepareNewItem(raw: unknown, ctx: WriteCtx): PreparedItem {
  if (!canEditItems(ctx.role)) return fail(READ_ONLY_ROLE);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("Each item is an object with at least a name.");
  const args = raw as Record<string, unknown>;
  const row: Record<string, unknown> = {};
  const values: Record<string, unknown> = {};
  const lists: ListOp[] = [];
  const warnings: string[] = [];
  let group: GroupNote | null = null;

  // refuse before anything else: a forbidden or unknown key is the clearest mistake
  for (const k of Object.keys(args)) {
    const target = ALIASES[k] ?? k;
    const why = whyNot(target);
    if (why) return fail(why);
  }

  const name = args.name ?? args.initiative_name;
  if (typeof name !== "string" || name.trim() === "") return fail("An initiative needs a name.");
  const n = validateEdit("initiative_name", name);
  if (!n.ok) return fail(`name: ${n.error}`);
  row.initiative_name = n.value;
  values.initiative_name = n.value;

  const projectArg = args.project ?? args.home_project;
  if (projectArg === undefined || projectArg === null || projectArg === "") {
    if (ctx.projects.length !== 1) return fail(`Choose a project with project. Projects: ${quote(ctx.projects.map((p) => p.name))}.`);
    row.home_project_id = ctx.projects[0]!.id;
    values.home_project = ctx.projects[0]!.name;
  } else {
    const p = resolveProject(String(projectArg), ctx);
    if (!p.ok) return fail(p.error);
    row.home_project_id = p.id;
    values.home_project = p.name;
  }

  const groupArg = args.group ?? args.theme;
  if (typeof groupArg === "string" && groupArg.trim() !== "") {
    const c = cleanGroupName(groupArg);
    if (!c.ok) return fail(`group: ${c.error}`);
    const g = resolveGroup(c.name, ctx.groups);
    if (g.kind === "empty") return fail("group: type a group name.");
    row.theme = g.name;
    values.theme = g.name;
    group = { name: g.name, created: g.kind === "new", similar: g.kind === "new" ? g.similar : [] };
  }

  for (const [k, v] of Object.entries(args)) {
    if (ALIASES[k] || v === undefined || k === BASIS_KEY) continue;
    if (CLAUDE_LIST_FIELDS.includes(k)) {
      const l = listValues(k, v, ctx);
      if (!l.ok) return l;
      for (const value of l.values) lists.push({ op: "list_add", field: k, value });
      values[k] = l.display;
      continue;
    }
    const c = coerce(k, v, ctx);
    if (!c.ok) return c;
    if (c.note) warnings.push(c.note);
    if (c.value === null) continue; // an empty value on a new item is just absent
    row[c.column] = c.value;
    values[k] = c.display;
  }

  let basis: string | undefined;
  if ("value_type" in row) {
    const c = cleanBasis(args[BASIS_KEY]);
    if (!c.ok) return fail(c.error);
    basis = c.basis;
  } else if (args[BASIS_KEY] !== undefined) {
    return fail(`${BASIS_KEY} only goes together with value_type.`);
  }

  if (ESTIMATE_KEYS.some((k) => k in values) && !("estimate_basis" in values)) {
    row.estimate_basis = "Rough guess";
    values.estimate_basis = "Rough guess";
    warnings.push("Estimates were set by Claude, so Estimate Basis is Rough guess until a person checks them.");
  }
  warnings.push(...stageWarnings(values));
  return { ok: true, row, values, lists, group, warnings, ...(basis ? { basis } : {}) };
}

/** What the person sees for one field of a diff. `confirm` is true when the field already holds something. */
export type DiffLine = { field: string; label: string; old: unknown; new: unknown; confirm: boolean };
/** One field of an update: the line to show, what was stored when it was read (to spot a change in between) and the writes that make it so. */
export type UpdateChange = DiffLine & { before: unknown; cols: Record<string, unknown>; lists: ListOp[]; /** The person's own words behind a Business Value Type change. */ basis?: string };
export type PreparedUpdate =
  | { ok: true; item: string; code: string; set: Record<string, unknown>; lists: ListOp[]; lines: DiffLine[]; changes: UpdateChange[]; group: GroupNote | null; warnings: string[] }
  | Fail;
export type UpdateCurrent = {
  /** The initiative as the search returns it: field keys, people and project as ids. */
  current: Record<string, unknown>;
  /** The list fields that live in other tables, in their stored form (teams as ids). */
  lists: Record<string, string[]>;
};

const sameValue = (a: unknown, b: unknown) => (isEmpty(a) && isEmpty(b)) || String(a) === String(b);

/** Compares what Claude wants with what is stored: one line per field that really changes, and the writes that make it so. */
export function buildUpdate(raw: unknown, now: UpdateCurrent, ctx: WriteCtx): PreparedUpdate {
  if (!canEditItems(ctx.role)) return fail(READ_ONLY_ROLE);
  if (!raw || typeof raw !== "object") return fail("Each update is an object with item (a code such as R-12) and set.");
  const u = raw as Record<string, unknown>;
  const code = String(now.current.item_code ?? u.item ?? "");
  const item = String(now.current.id ?? "");
  const set = u.set;
  if (!set || typeof set !== "object" || Array.isArray(set) || Object.keys(set).length === 0) return fail(`${code}: set the fields to change, for example {"moscow": "Must"}.`);

  const changes: UpdateChange[] = [];
  const warnings: string[] = [];
  let group: GroupNote | null = null;
  const label = (key: string) => FIELD_BY_KEY[key]?.name ?? key;

  const setArgs = set as Record<string, unknown>;
  if (BASIS_KEY in setArgs && !("value_type" in setArgs)) return fail(`${code}: ${BASIS_KEY} only goes together with value_type.`);
  let basis: string | undefined;
  if ("value_type" in setArgs) {
    const c = cleanBasis(setArgs[BASIS_KEY]);
    if (!c.ok) return fail(`${code}: ${c.error}`);
    basis = c.basis;
  }

  for (const [k0, v] of Object.entries(setArgs)) {
    if (k0 === BASIS_KEY) continue;
    const key = ALIASES[k0] ?? k0;
    const why = whyNot(key);
    if (why) return fail(`${code}: ${why}`);
    if (key === "artifacts") return fail(`${code}: links are changed with add_link and remove_link.`);
    if (key === "depends_on" || key === "related_to") return fail(`${code}: relations are changed with set_relations.`);

    if (CLAUDE_LIST_FIELDS.includes(key)) {
      const l = listValues(key, v, ctx, item);
      if (!l.ok) return fail(`${code}: ${l.error}`);
      const before = now.lists[key] ?? [];
      const display = (xs: unknown[]) => (key === "contributing_teams" ? xs.map((x) => ctx.teams.find((t) => t.id === x)?.name ?? String(x)) : xs);
      const wantKeys = (l.values as string[]).map((x) => norm(x));
      const have = before.map(norm);
      const gone = before.filter((x) => !wantKeys.includes(norm(x)));
      const fresh = (l.values as string[]).filter((x) => !have.includes(norm(x)));
      if (gone.length === 0 && fresh.length === 0) continue;
      const ops: ListOp[] = [...gone.map((g) => ({ op: "list_remove" as const, field: key, value: g })), ...fresh.map((f) => ({ op: "list_add" as const, field: key, value: f }))];
      changes.push({ field: key, label: label(key), old: display(before), new: display(l.values), confirm: requiresConfirmation(before), before, cols: {}, lists: ops });
      continue;
    }

    let value: unknown;
    let shown: unknown;
    let column: string;
    if (key === "theme") {
      if (v === null || v === "") {
        value = null; shown = null; column = "theme";
      } else {
        const c = cleanGroupName(String(v));
        if (!c.ok) return fail(`${code}: group: ${c.error}`);
        const g = resolveGroup(c.name, ctx.groups);
        if (g.kind === "empty") return fail(`${code}: group: type a group name.`);
        value = g.name; shown = g.name; column = "theme";
        group = { name: g.name, created: g.kind === "new", similar: g.kind === "new" ? g.similar : [] };
      }
    } else if (key === "home_project") {
      if (v === null || v === "") return fail(`${code}: Project cannot be empty.`);
      const p = resolveProject(String(v), ctx);
      if (!p.ok) return fail(`${code}: ${p.error}`);
      value = p.id; shown = p.name; column = "home_project_id";
    } else {
      const c = coerce(key, v, ctx);
      if (!c.ok) return fail(`${code}: ${c.error}`);
      if (c.note) warnings.push(c.note);
      value = c.value; shown = c.display; column = c.column;
    }

    const stored = now.current[key];
    if (sameValue(stored, value)) continue;
    const oldShown =
      key === "home_project" ? ctx.projects.find((p) => p.id === stored)?.name ?? stored
      : FIELD_BY_KEY[key]?.type === "Person" ? ctx.members.find((m) => m.id === stored)?.name ?? stored
      : stored;
    changes.push({ field: key, label: label(key), old: isEmpty(oldShown) ? null : oldShown, new: shown, confirm: requiresConfirmation(stored), before: stored ?? null, cols: { [column]: value }, lists: [], ...(key === "value_type" && basis ? { basis } : {}) });
  }

  const estimates = changes.filter((c) => ESTIMATE_KEYS.includes(c.field));
  if (estimates.length > 0 && !("estimate_basis" in (set as object)) && isEmpty(now.current.estimate_basis)) {
    // the basis follows its estimate: held together with it, so a held estimate never gets a "Rough guess" label on its own
    changes.push({ field: "estimate_basis", label: label("estimate_basis"), old: null, new: "Rough guess", confirm: estimates.some((c) => c.confirm), before: null, cols: { estimate_basis: "Rough guess" }, lists: [] });
    warnings.push("Estimates were set by Claude, so Estimate Basis is Rough guess until a person checks them.");
  }
  const lines: DiffLine[] = changes.map(({ field, label: l, old, new: n, confirm }) => ({ field, label: l, old, new: n, confirm }));
  return { ok: true, item, code, set: Object.assign({}, ...changes.map((c) => c.cols)), lists: changes.flatMap((c) => c.lists), lines, changes, group, warnings };
}

/** A list of up to 50 things to write, or a sentence saying what to send instead. */
export function splitBatch(raw: unknown, name: string): { ok: true; items: unknown[] } | Fail {
  if (!Array.isArray(raw) || raw.length === 0) return fail(`Send ${name} as a list with at least one entry.`);
  if (raw.length > MAX_WRITE_BATCH) {
    return fail(`${raw.length} ${name} is more than the ${MAX_WRITE_BATCH} allowed in one call. Nothing was written; send the first ${MAX_WRITE_BATCH} now and the remaining ${raw.length - MAX_WRITE_BATCH} in another call.`);
  }
  return { ok: true, items: raw };
}

/** True when the stored value is no longer what the diff was made from: someone changed it in between, so the diff must not overwrite it. */
export function isStale(change: Pick<UpdateChange, "before" | "lists">, field: string, now: UpdateCurrent): boolean {
  if (CLAUDE_LIST_FIELDS.includes(field)) {
    const cur = (now.lists[field] ?? []).map(norm).sort().join("\u0000");
    const was = (Array.isArray(change.before) ? (change.before as string[]) : []).map(norm).sort().join("\u0000");
    return cur !== was;
  }
  return !sameValue(now.current[field], change.before);
}

/** Hosts whose pages usually ask for a login: said in the result so Claude can tell the person that others may not be able to open the link. */
const LOGIN_HOSTS: [RegExp, string][] = [
  [/(^|\.)atlassian\.net$/, "Atlassian"], [/(^|\.)notion\.(so|site)$/, "Notion"], [/(^|\.)(docs|drive|sheets|slides)\.google\.com$/, "Google Drive"],
  [/(^|\.)figma\.com$/, "Figma"], [/(^|\.)sharepoint\.com$/, "SharePoint"], [/(^|\.)linear\.app$/, "Linear"], [/(^|\.)miro\.com$/, "Miro"],
  [/(^|\.)claude\.ai$/, "Claude"], [/(^|\.)slack\.com$/, "Slack"],
];
/** A note when the link is known to need a login or cannot be opened by other people; null when nothing is known. */
export function linkLoginNote(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "localhost" || /^(127\.|10\.|192\.168\.)/.test(host) || host.endsWith(".local")) return "This address only works on one computer or network, so other people cannot open it.";
  const hit = LOGIN_HOSTS.find(([re]) => re.test(host));
  return hit ? `${hit[1]} pages usually need a login, so people without access may not be able to open this link.` : null;
}
