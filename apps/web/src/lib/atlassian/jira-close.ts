import { withBackoff, whyJira, type JiraRequest, type Sleep } from "./jira-write";
import { ReconnectNeeded } from "./token-provider";
import { REMOVED_LABEL } from "./outbound";

// Closing the Jira issue of an initiative that was removed in Product Velocity (decision 2026-11-03-jira-close-removed).
// THIS IS THE ONLY MODULE THAT MAY TRANSITION A JIRA ISSUE, and only jira-removed-engine.ts may import it (a test fails otherwise): CLAUDE.md
// rule 6 says status is tracker-driven, and Ashu's exception is exactly one thing: an explicit, confirmed, per-initiative close of an issue
// Product Velocity owns, after the initiative was deleted. Two writes exist here: add the label `pv:removed` (every other label stays: Jira's
// own "add" operation) and POST a transition whose target status is in the status CATEGORY `done` (status names mean nothing, only the
// category does). The transition id is always checked against a fresh GET /transitions; one that is not a Done transition is refused before
// any write. There is no delete and no reopen. Pure over an injected request, so it is tested with a fake Jira.

const KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
/** Text from Jira is data: shown as plain text, cut, without control characters. */
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

export type DoneTransition = { id: string; name: string; toStatusId: string; toStatusName: string };
export type CloseState =
  | { ok: true; statusName: string; statusCategory: string; labels: string[]; done: DoneTransition[] }
  | { ok: false; kind: "gone" | "reconnect" | "unavailable"; message: string };
export type CloseFail = { ok: false; kind: "reconnect" | "rejected" | "rate_limited" | "unavailable" | "gone"; message: string };

const RECONNECT: CloseFail = { ok: false, kind: "reconnect", message: "Jira needs you to sign in again (Settings, Integrations, Jira). Nothing was written." };
async function guarded<T>(f: () => Promise<T>): Promise<T | CloseFail> {
  try { return await f(); } catch (e) { return e instanceof ReconnectNeeded ? RECONNECT : { ok: false, kind: "unavailable", message: "Jira could not be reached. Try again." }; }
}
function refusal(status: number, json: unknown): CloseFail {
  const why = whyJira(json);
  if (status === 401) return { ok: false, kind: "reconnect", message: "Jira refused the sign-in. Sign in again (Settings, Integrations, Jira)." };
  if (status === 404) return { ok: false, kind: "gone", message: "The Jira issue no longer exists or you cannot see it. Nothing was changed." };
  if (status === 429) return { ok: false, kind: "rate_limited", message: "Jira is limiting requests right now. Try again in a minute." };
  if (status >= 500) return { ok: false, kind: "unavailable", message: "Jira had a problem. Try again." };
  return { ok: false, kind: "rejected", message: why ? `Jira refused it: ${why}` : `Jira refused it (${status}).` };
}

/** The transitions of the issue whose target status is in the category `done`, as Jira lists them (read only). */
export function doneTransitionsOf(json: unknown): DoneTransition[] {
  const list = Array.isArray(obj(json).transitions) ? (obj(json).transitions as unknown[]) : [];
  const out: DoneTransition[] = [];
  for (const t of list) {
    const o = obj(t);
    const to = obj(o.to);
    if (obj(to.statusCategory).key !== "done") continue;
    if (typeof o.id !== "string" || !/^[0-9]{1,10}$/.test(o.id) || typeof to.id !== "string" || !/^[0-9]{1,20}$/.test(to.id)) continue;
    out.push({ id: o.id, name: clean(o.name, 100), toStatusId: to.id, toStatusName: clean(to.name, 100) });
  }
  return out;
}

/** Reads (no write): the issue's current status and labels, and its transitions into a Done status. */
export async function readCloseState(call: JiraRequest, key: string, sleep?: Sleep): Promise<CloseState> {
  if (!KEY.test(key)) return { ok: false, kind: "gone", message: "Not a Jira issue key." };
  const g = await guarded(async () => {
    const issue = await withBackoff(() => call("GET", `/issue/${key}?fields=status,labels`), sleep);
    if (issue.status !== 200) return issue;
    const tr = await withBackoff(() => call("GET", `/issue/${key}/transitions`), sleep);
    return { status: tr.status, json: { issue: issue.json, transitions: tr.json } };
  });
  if ("ok" in g) return g.kind === "rejected" || g.kind === "rate_limited" ? { ok: false, kind: "unavailable", message: g.message } : (g as CloseState);
  if (g.status === 404) return { ok: false, kind: "gone", message: "Jira did not return this issue (deleted, moved or not visible to the connection). Nothing was changed." };
  if (g.status === 401) return { ok: false, kind: "reconnect", message: "Jira refused the sign-in. Sign in again (Settings, Integrations, Jira)." };
  if (g.status !== 200) return { ok: false, kind: "unavailable", message: "Jira could not be read just now. Try again in a minute." };
  const issue = obj(obj(g.json).issue);
  const f = obj(issue.fields);
  const st = obj(f.status);
  return {
    ok: true,
    statusName: clean(st.name, 100),
    statusCategory: clean(obj(st.statusCategory).key, 20),
    labels: Array.isArray(f.labels) ? f.labels.filter((l): l is string => typeof l === "string") : [],
    done: doneTransitionsOf(obj(g.json).transitions),
  };
}

/** Which transition to use. One candidate: it. Several: the chosen id when it is among them, else the one into the status remembered for the project, else none (the person chooses). */
export function chooseTransition(done: DoneTransition[], chosenId: string | null, rememberedStatusId: string | null): { transition: DoneTransition | null; needsChoice: boolean; chosenNotAllowed: boolean } {
  if (done.length === 0) return { transition: null, needsChoice: false, chosenNotAllowed: false };
  if (chosenId !== null) {
    const hit = done.find((t) => t.id === chosenId);
    return { transition: hit ?? null, needsChoice: false, chosenNotAllowed: !hit };
  }
  if (done.length === 1) return { transition: done[0]!, needsChoice: false, chosenNotAllowed: false };
  const remembered = rememberedStatusId ? done.filter((t) => t.toStatusId === rememberedStatusId) : [];
  return remembered.length === 1 ? { transition: remembered[0]!, needsChoice: false, chosenNotAllowed: false } : { transition: null, needsChoice: true, chosenNotAllowed: false };
}

/** Adds the label `pv:removed` and nothing else: Jira's "add" operation keeps every other label (PUT answers 204). */
export async function addRemovedLabel(call: JiraRequest, key: string, sleep?: Sleep): Promise<{ ok: true } | CloseFail> {
  if (!KEY.test(key)) return { ok: false, kind: "rejected", message: "Not a Jira issue key." };
  const g = await guarded(() => withBackoff(() => call("PUT", `/issue/${key}`, { update: { labels: [{ add: REMOVED_LABEL }] } }), sleep));
  if ("ok" in g) return g;
  return g.status === 204 || g.status === 200 ? { ok: true } : refusal(g.status, g.json);
}

/** Moves the issue with a transition that is a Done transition of THIS issue right now (checked against `done`, read just before). A refusal is returned, never retried. */
export async function closeWith(call: JiraRequest, key: string, transitionId: string, done: DoneTransition[], sleep?: Sleep): Promise<{ ok: true } | CloseFail> {
  if (!KEY.test(key)) return { ok: false, kind: "rejected", message: "Not a Jira issue key." };
  if (!done.some((t) => t.id === transitionId)) return { ok: false, kind: "rejected", message: "That is not a transition to a Done status of this issue." };
  const g = await guarded(() => withBackoff(() => call("POST", `/issue/${key}/transitions`, { transition: { id: transitionId } }), sleep));
  if ("ok" in g) return g;
  return g.status === 204 || g.status === 200 ? { ok: true } : refusal(g.status, g.json);
}
