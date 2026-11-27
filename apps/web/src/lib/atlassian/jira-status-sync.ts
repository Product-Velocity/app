import { withBackoff, whyJira, type JiraRequest, type Sleep } from "./jira-write";

// Initiative Status to the Jira workflow status (issue 738, decision 2026-11-27-jira-initiative-status-sync). The THIRD narrow status write (after jira-close.ts and
// jira-ready.ts), and only the confirmed send engine may import this module (transition-guard.test.ts fails otherwise). Per project the admin switches it on and maps
// each Initiative Status to one Jira status of the initiative issue type. One way, Product Velocity to Jira. It moves the issue that IS the initiative with the workflow's
// own transition: the transition id is always taken from a fresh GET /transitions and must lead to exactly the mapped status; a workflow that does not allow it means a note
// and no write. It never creates a status, never edits a workflow, never touches an epic, story or task, never writes Build Status or a date. Pure over an injected request.

const KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;
const ID = /^[0-9]{1,12}$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

export type Transition = { id: string; name: string; toId: string; toName: string };
/** The transitions Jira lists for the issue, with the status each leads to. */
export function transitionsOf(json: unknown): Transition[] {
  const out: Transition[] = [];
  for (const t of Array.isArray(obj(json).transitions) ? (obj(json).transitions as unknown[]) : []) {
    const o = obj(t), to = obj(o.to);
    if (typeof o.id !== "string" || !ID.test(o.id) || typeof to.id !== "string" || !ID.test(to.id)) continue;
    out.push({ id: o.id, name: clean(o.name, 100), toId: to.id, toName: clean(to.name, 100) });
  }
  return out;
}

export type StatusSyncPlan =
  | { state: "none" }
  | { state: "already"; text: string }
  | { state: "set"; text: string; transition: Transition; from: string; to: string }
  | { state: "blocked"; text: string };

/** Pure decision from what Jira says now. `target` is the mapped Jira status of the initiative's Initiative Status. */
export function decideStatusSync(target: { id: string; name: string }, current: { id: string; name: string }, transitions: Transition[]): StatusSyncPlan {
  const options = transitions.filter((t) => t.toId === target.id).sort((a, b) => Number(a.id) - Number(b.id));
  const to = target.name || options[0]?.toName || "the mapped status";
  if (current.id === target.id) return { state: "already", text: `Status is already ${current.name || to}.` };
  if (options.length === 0) return { state: "blocked", text: `Jira's workflow allows no move from ${current.name || "the current status"} to ${to}: nothing was written. Move it in Jira, or add that transition to the workflow.` };
  return { state: "set", text: `Move the status from ${current.name || "its current status"} to ${to}`, transition: options[0]!, from: current.name, to };
}

export type StatusRead = { ok: true; plan: StatusSyncPlan } | { ok: false; message: string };
const LATER = "Jira could not be read just now, so its status is left as it is.";

/** Reads (no write) the issue's status and its allowed transitions and decides. `targetName` is only for words. */
export async function planStatusSync(call: JiraRequest, key: string, target: { id: string; name: string }, sleep?: Sleep): Promise<StatusRead> {
  if (!KEY.test(key)) return { ok: false, message: "Not a Jira issue key." };
  if (!ID.test(target.id)) return { ok: false, message: "The mapped Jira status is not valid." };
  const issue = await withBackoff(() => call("GET", `/issue/${key}?fields=status`), sleep);
  if (issue.status !== 200) return { ok: false, message: LATER };
  const st = obj(obj(obj(issue.json).fields).status);
  const current = { id: typeof st.id === "string" ? st.id : "", name: clean(st.name, 100) };
  if (current.id === target.id) return { ok: true, plan: decideStatusSync(target, current, []) };
  const tr = await withBackoff(() => call("GET", `/issue/${key}/transitions`), sleep);
  if (tr.status !== 200) return { ok: false, message: LATER };
  return { ok: true, plan: decideStatusSync(target, current, transitionsOf(tr.json)) };
}

export type StatusWrite = { ok: true; result: "set" | "already"; status: string } | { ok: false; message: string };

/** Applies the plan: reads again first, so a status that moved since the preview is judged on what Jira says now. */
export async function writeStatusSync(call: JiraRequest, key: string, target: { id: string; name: string }, sleep?: Sleep): Promise<StatusWrite> {
  const fresh = await planStatusSync(call, key, target, sleep);
  if (!fresh.ok) return fresh;
  const p = fresh.plan;
  if (p.state === "already") return { ok: true, result: "already", status: target.name };
  if (p.state !== "set") return { ok: false, message: p.state === "blocked" ? p.text : "Nothing to do." };
  const r = await withBackoff(() => call("POST", `/issue/${key}/transitions`, { transition: { id: p.transition.id } }), sleep);
  if (r.status === 204 || r.status === 200) return { ok: true, result: "set", status: p.to };
  const why = whyJira(r.json);
  return { ok: false, message: r.status === 429 ? "Jira is limiting requests right now. Try again in a minute." : why ? `Jira refused it: ${why}` : `Jira refused it (${r.status}).` };
}
