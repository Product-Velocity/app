// Epic keys at creation (issue #431, docs/decisions/2026-11-13-tracker-initiative-level.md): a person lists the keys of the Jira epics that belong
// under an initiative; the preview of Sync with Jira says, per epic, what a confirmed send would do; the send sets each epic's PARENT to the
// initiative's Jira issue (an issue above Epic) and nothing else about the epic. Pure over an injected `call`, so it is tested with a fake Jira.
// Text from Jira (titles, types) is data: it is cut and cleaned by the reader and only ever shown as text.
import type { JiraIssueRow } from "./read-issues";
import { updateIssue, type JiraRequest, type Sleep } from "./jira-write";
import { ReconnectNeeded } from "./token-provider";

export type EpicRequest = { key: string; state: "pending" | "failed"; lastError: string | null };
export type EpicPlanLine = {
  key: string;
  /** What the preview says about this epic, in words. */
  text: string;
  /** True when the confirmed send writes something for this epic (sets its parent). */
  will: boolean;
  /** The epic is already under the initiative's issue: nothing is written, the request is just recorded as done. */
  already?: boolean;
  /** The parent the epic has now (null: none), kept so a person can put it back. */
  previousParent: string | null;
};

export const EPICS_NEED_ABOVE_EPIC = "Epics can only go under an issue above Epic level. This project's initiative type is at Epic level or below: change it on the Jira page first.";

/**
 * What a confirmed send would do for each requested epic.
 * - `initiativeKey`: the Jira issue of the initiative, or null while it is not created yet (the send creates it first).
 * - `aboveEpic`: whether the project's initiative type is above Epic (true), not (false) or could not be told (null: Jira decides and says why).
 * - `read`/`missing`: the requested keys as Jira returned them (readIssuesByKey), and the ones it did not.
 */
export function planEpics(opts: { requests: EpicRequest[]; read: JiraIssueRow[]; missing: string[]; initiativeKey: string | null; aboveEpic: boolean | null }): EpicPlanLine[] {
  const rows = new Map(opts.read.map((r) => [r.key, r]));
  const lines: EpicPlanLine[] = [];
  for (const req of opts.requests) {
    const r = rows.get(req.key);
    const none = { key: req.key, will: false, previousParent: null as string | null };
    if (opts.aboveEpic === false) { lines.push({ ...none, text: EPICS_NEED_ABOVE_EPIC }); continue; }
    if (!r) { lines.push({ ...none, text: `Jira does not return ${req.key}: it does not exist or this sign-in cannot see it.` }); continue; }
    if (r.level !== 1) { lines.push({ ...none, text: `${req.key} is ${r.type ? `a ${r.type}` : "not an epic"}${r.level === null ? "" : ` (level ${r.level})`}, not an epic: only epics go under an Initiative.` }); continue; }
    const title = r.title ? ` ${r.title}` : "";
    if (opts.initiativeKey && r.parent === opts.initiativeKey) { lines.push({ key: req.key, will: false, already: true, previousParent: r.parent, text: `${req.key}${title}: already under it.` }); continue; }
    lines.push({
      key: req.key, will: true, previousParent: r.parent,
      text: r.parent ? `${req.key}${title}: moves under it (now under ${r.parent}).` : `${req.key}${title}: gets it as its parent (it has none now).`,
    });
  }
  return lines;
}

/**
 * Which planned epics are linked at once when Sync with Jira runs and which wait for a person's confirmation (issue #528, Ashu 2026-11-18: listing the
 * epic ID on the initiative is the approval). Linked at once: an epic that has no parent (nothing of anybody else's is moved) and one that is already
 * under the initiative (only recorded). Asks first: an epic that is under another parent (a move). Lines that cannot be written are neither.
 */
export function splitEpicPlan(lines: EpicPlanLine[]): { auto: EpicPlanLine[]; ask: EpicPlanLine[] } {
  const auto = lines.filter((l) => l.already === true || (l.will && l.previousParent === null));
  return { auto, ask: lines.filter((l) => l.will && l.previousParent !== null) };
}

export type EpicLinkResult = { key: string; ok: boolean; previousParent: string | null; error: string | null };

/**
 * Sets the parent of every epic the plan says will be written, one call each (the only thing written to an epic). An epic that is already there is
 * reported as done without a write; one Jira refuses is reported with Jira's reason and does not stop the others. A lost sign-in throws (the caller
 * shows it and never retries).
 */
export async function linkEpics(call: JiraRequest, lines: EpicPlanLine[], initiativeKey: string, sleep?: Sleep): Promise<EpicLinkResult[]> {
  if (!/^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/.test(initiativeKey)) throw new Error("Not a Jira issue key.");
  const out: EpicLinkResult[] = [];
  for (const line of lines) {
    if (line.already) { out.push({ key: line.key, ok: true, previousParent: null, error: null }); continue; }
    if (!line.will) continue;
    const w = await updateIssue(call, line.key, { parent: { key: initiativeKey } }, sleep);
    if (!w.ok && w.kind === "reconnect") throw new ReconnectNeeded();
    out.push(w.ok ? { key: line.key, ok: true, previousParent: line.previousParent, error: null } : { key: line.key, ok: false, previousParent: line.previousParent, error: w.message });
  }
  return out;
}

/** The sentence for the result of a send. */
export function epicResultText(results: EpicLinkResult[], initiativeKey: string): string | null {
  if (results.length === 0) return null;
  const ok = results.filter((r) => r.ok).map((r) => r.key);
  const bad = results.filter((r) => !r.ok);
  const parts: string[] = [];
  if (ok.length > 0) parts.push(`${ok.length === 1 ? "1 epic is" : `${ok.length} epics are`} now under ${initiativeKey} (${ok.join(", ")}).`);
  for (const b of bad) parts.push(`${b.key} was not moved: ${b.error}`);
  return parts.join(" ");
}
