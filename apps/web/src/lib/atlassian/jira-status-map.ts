// Initiative Status to the Jira workflow status (issue 738): the mapping, with nothing that talks to Jira. The settings screen and its save action use this;
// the transition itself lives in jira-status-sync.ts, which only the send engine may import (transition-guard.test.ts).

const ID = /^[0-9]{1,12}$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export const INITIATIVE_STATUSES = ["Backlog", "Active", "On hold", "Completed", "Cancelled"] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];
/** Initiative Status -> Jira status id. A value that is not here leaves Jira alone. */
export type StatusMap = Partial<Record<InitiativeStatus, string>>;
export type JiraStatusOption = { id: string; name: string; category: "new" | "indeterminate" | "done" | null };

/** A stored mapping to what the sender uses; anything malformed is dropped, so a bad value can never reach a Jira request. */
export function parseStatusMap(raw: unknown): StatusMap {
  const o = obj(raw);
  const out: StatusMap = {};
  for (const v of INITIATIVE_STATUSES) { const id = o[v]; if (typeof id === "string" && ID.test(id)) out[v] = id; }
  return out;
}

/** The statuses of the project's initiative issue type, from GET /project/{key}/statuses (one entry per issue type). */
export function statusesOfType(json: unknown, issueTypeId: string): JiraStatusOption[] {
  const types = Array.isArray(json) ? json : [];
  const t = types.map(obj).find((x) => String(x.id) === issueTypeId);
  const out: JiraStatusOption[] = [];
  for (const s of Array.isArray(t?.statuses) ? (t!.statuses as unknown[]) : []) {
    const o = obj(s);
    const cat = obj(o.statusCategory).key;
    if (typeof o.id !== "string" || !ID.test(o.id)) continue;
    out.push({ id: o.id, name: clean(o.name, 100), category: cat === "new" || cat === "indeterminate" || cat === "done" ? cat : null });
  }
  return out;
}

const ALIASES: Record<InitiativeStatus, string[]> = { Backlog: ["backlog"], Active: ["active"], "On hold": ["on hold", "on-hold"], Completed: ["completed", "done"], Cancelled: ["cancelled", "canceled"] };
/** A same-name status for each value that has none yet (Completed also matches "Done", Cancelled also "Canceled"); a status used once is not offered twice. */
export function suggestStatuses(options: JiraStatusOption[], saved: StatusMap = {}): StatusMap {
  const out: StatusMap = { ...saved };
  const used = new Set(Object.values(out));
  for (const v of INITIATIVE_STATUSES) {
    if (out[v]) continue;
    const hit = options.find((o) => !used.has(o.id) && ALIASES[v].includes(norm(o.name)));
    if (hit) { out[v] = hit.id; used.add(hit.id); }
  }
  return out;
}

