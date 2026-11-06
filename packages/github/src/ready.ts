import { GitHubError, type BoardField, type SourceControl } from "./source-control";
import { detectMapping, type BoardMapping, type FieldRef } from "./board";

// "Ready for build" on a GitHub Project board (issue #358; decision 2026-11-06-ready-at-gate-b). When an initiative is Ready for build (Gate B, Go or Go with
// conditions) and the person confirms Sync, the board's Status of its issue is set to the existing option "Ready" so engineers can see what to pick up.
// The second narrow exception to "Status is GitHub's" (the first is closing a removed initiative). Nothing else about Status is ever written:
//  - only forward from the start: Status empty or "Backlog"; anything else (In progress, Done, Ready already) is never changed, never moved back, never cleared;
//  - only the option that already exists on the board; PV creates no field and no option (a board without "Ready" gets a note and no write);
//  - only for an issue Product Velocity owns (link mode push), once (the database remembers it was handled);
//  - no field of the initiative is read: the decision is made from the board alone (commercial fields never leave, rule 2).
// Pure planning plus one guarded write over an injected SourceControl, so it is tested with a fake GitHub.

export const READY_OPTION = "Ready";
export const READY_LABEL = "Set Status to Ready";
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const isStart = (s: string | null | undefined) => norm(s) === "" || norm(s) === "backlog";

export type ReadyPlan =
  | { state: "none" } // not applicable: nothing shown
  | { state: "set"; text: string; field: FieldRef; optionId: string }
  | { state: "already"; text: string }
  | { state: "ahead"; text: string }
  | { state: "blocked"; text: string };

export type ReadyInput = {
  /** ready_for_build_at is set and the phase is Build (Gate B passed). */
  ready: boolean;
  /** Only "push" (Product Velocity owns the issue) is ever touched. */
  mode: "push" | "follow" | null;
  handled: boolean;
  frozen?: boolean;
  /** The board's fields and mapping; null when there is no board or it could not be read. */
  fields: BoardField[] | null;
  mapping: BoardMapping | null;
  /** The board's Status of the issue now (stored Delivery Status in the preview, read live when writing); null = none. */
  current: string | null;
};

export function planReadyBoard(i: ReadyInput): ReadyPlan {
  if (!i.ready || i.handled || i.frozen || i.mode === "follow" || !i.mapping) return { state: "none" };
  if (!i.fields) return { state: "blocked", text: "The board could not be read just now, so its Status is left as it is." };
  const ref = i.mapping.status ?? detectMapping(i.fields).status;
  const field = ref ? (i.fields.find((f) => f.id === ref.id) ?? i.fields.find((f) => norm(f.name) === norm(ref.name))) : undefined;
  if (!field || field.dataType !== "SINGLE_SELECT") return { state: "blocked", text: "The board has no single-select Status field, so nothing was set to Ready." };
  if (norm(i.current) === norm(READY_OPTION)) return { state: "already", text: "Status is already Ready." };
  if (!isStart(i.current)) return { state: "ahead", text: `Status is ${i.current}: it is already past the start, so it is not moved.` };
  const option = field.options?.find((o) => norm(o.name) === norm(READY_OPTION));
  if (!option) return { state: "blocked", text: `The board's "${field.name}" has no option "${READY_OPTION}": add Ready in GitHub, nothing was written for it.` };
  return { state: "set", text: READY_LABEL, field: { id: field.id, name: field.name }, optionId: option.id };
}

export type ReadyWrite = { ok: true; result: "set" | "already_ahead"; status: string | null } | { ok: false; message: string };

/** Reads the item's Status again and, only if it is still at the start, sets Ready. Never moves anything that is further along. */
export async function writeReadyStatus(sc: SourceControl, installationId: number, boardId: string, boardItemId: string, plan: Extract<ReadyPlan, { state: "set" }>): Promise<ReadyWrite> {
  try {
    const values = await sc.getBoardItemValues(installationId, boardItemId);
    const current = values?.[plan.field.id]?.option ?? null;
    if (norm(current) === norm(READY_OPTION)) return { ok: true, result: "already_ahead", status: current };
    if (!isStart(current)) return { ok: true, result: "already_ahead", status: current };
    await sc.setBoardValue(installationId, boardId, boardItemId, plan.field.id, { optionId: plan.optionId });
    return { ok: true, result: "set", status: READY_OPTION };
  } catch (e) {
    return { ok: false, message: e instanceof GitHubError ? `GitHub refused it (${e.status})${e.detail ? `: ${e.detail}` : ""}` : "GitHub could not be reached." };
  }
}
