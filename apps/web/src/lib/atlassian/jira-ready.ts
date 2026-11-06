import { withBackoff, whyJira, type JiraRequest, type Sleep } from "./jira-write";

// "Ready for build" in Jira (issue #358; decision 2026-11-06-ready-at-gate-b). When an initiative is Ready for build (Gate B) and the person confirms Sync, the
// Jira issue Product Velocity owns is moved to the "To do" status with the workflow's own transition. The second narrow transition exception (the first is
// jira-close.ts). Boundaries: only forward from the start (the issue's status CATEGORY is "To Do", key `new`, and it is not already the status named To do);
// only a transition whose target is in the category To Do (names mean nothing, the category does) and, when several, the one named "To do"; none allowed means
// a note and no write; never a move back from In Progress or Done; no field of the initiative is read (rule 2). Pure over an injected request.

const KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const TODO_NAME = /^to ?do$/;

export const READY_TEXT = "Move to To do";
export type TodoTransition = { id: string; name: string; toStatusName: string };
export type JiraReadyPlan =
  | { state: "none" }
  | { state: "set"; text: string; transition: TodoTransition; from: string }
  | { state: "already"; text: string }
  | { state: "ahead"; text: string }
  | { state: "blocked"; text: string };

/** The transitions whose target status is in the category To Do (key `new`), as Jira lists them. */
export function todoTransitionsOf(json: unknown): TodoTransition[] {
  const list = Array.isArray(obj(json).transitions) ? (obj(json).transitions as unknown[]) : [];
  const out: TodoTransition[] = [];
  for (const t of list) {
    const o = obj(t);
    const to = obj(o.to);
    if (obj(to.statusCategory).key !== "new") continue;
    if (typeof o.id !== "string" || !/^[0-9]{1,10}$/.test(o.id)) continue;
    out.push({ id: o.id, name: clean(o.name, 100), toStatusName: clean(to.name, 100) });
  }
  return out;
}

/** Pure decision from what Jira says now. */
export function decideReady(status: { name: string; category: string }, transitions: TodoTransition[]): JiraReadyPlan {
  if (status.category !== "new") return { state: "ahead", text: `Status is ${status.name || "further along"}: it is already past the start, so it is not moved.` };
  if (TODO_NAME.test(norm(status.name))) return { state: "already", text: "Status is already To do." };
  const named = transitions.filter((t) => TODO_NAME.test(norm(t.toStatusName)));
  const pick = named.length === 1 ? named[0]! : transitions.length === 1 && named.length === 0 ? transitions[0]! : null;
  if (!pick) return { state: "blocked", text: transitions.length === 0 ? `Jira's workflow allows no move from ${status.name} to a To do status: nothing was written. Move it in Jira.` : "Jira's workflow allows several To do statuses and none is named “To do”: nothing was written. Move it in Jira." };
  return { state: "set", text: READY_TEXT, transition: pick, from: status.name };
}

export type ReadyRead = { ok: true; plan: JiraReadyPlan } | { ok: false; message: string };

/** Reads (no write) the issue's status and its allowed transitions and decides. */
export async function planJiraReady(call: JiraRequest, key: string, sleep?: Sleep): Promise<ReadyRead> {
  if (!KEY.test(key)) return { ok: false, message: "Not a Jira issue key." };
  const issue = await withBackoff(() => call("GET", `/issue/${key}?fields=status`), sleep);
  if (issue.status !== 200) return { ok: false, message: "Jira could not be read just now, so its status is left as it is." };
  const st = obj(obj(obj(issue.json).fields).status);
  const status = { name: clean(st.name, 100), category: clean(obj(st.statusCategory).key, 20) };
  if (status.category !== "new") return { ok: true, plan: decideReady(status, []) };
  const tr = await withBackoff(() => call("GET", `/issue/${key}/transitions`), sleep);
  if (tr.status !== 200) return { ok: false, message: "Jira could not be read just now, so its status is left as it is." };
  return { ok: true, plan: decideReady(status, todoTransitionsOf(tr.json)) };
}

export type JiraReadyWrite = { ok: true; result: "set" | "already_ahead"; status: string } | { ok: false; message: string };

/** Applies the plan: reads again first, so a status that moved since the preview is never overwritten. */
export async function writeJiraReady(call: JiraRequest, key: string, sleep?: Sleep): Promise<JiraReadyWrite> {
  const fresh = await planJiraReady(call, key, sleep);
  if (!fresh.ok) return fresh;
  const p = fresh.plan;
  if (p.state === "ahead" || p.state === "already") return { ok: true, result: "already_ahead", status: p.text };
  if (p.state !== "set") return { ok: false, message: p.state === "blocked" ? p.text : "Nothing to do." };
  const r = await withBackoff(() => call("POST", `/issue/${key}/transitions`, { transition: { id: p.transition.id } }), sleep);
  if (r.status === 204 || r.status === 200) return { ok: true, result: "set", status: p.transition.toStatusName || "To do" };
  const why = whyJira(r.json);
  return { ok: false, message: r.status === 429 ? "Jira is limiting requests right now. Try again in a minute." : why ? `Jira refused it: ${why}` : `Jira refused it (${r.status}).` };
}
