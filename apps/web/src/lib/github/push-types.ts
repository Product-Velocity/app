// Shapes shared by the push server actions and the dialog (no server-only code here).
export const PUSH_LIMIT = 25;

export type PlanAction = "create" | "update" | "unchanged" | "blocked";
export type PlanItem = {
  id: string;
  code: string;
  name: string;
  project: string;
  repo: string | null;
  action: PlanAction;
  title: string;
  labels: string[];
  /** Milestone the issue is put in (the calendar quarter of the G2M date), when the item has a date. */
  milestone?: string;
  /** The linked GitHub Project (board): what would be written there, and anything left out and why. */
  board?: { title: string; included: boolean; writes: { field: string; value: string }[]; notes: string[]; /** Children (epics and tasks) that this send would also put on the board. */ children: number };
  /** The managed block exactly as it will be written. */
  block: string;
  issueNumber: number | null;
  issueUrl: string | null;
  reason?: string;
  /** Shared file links that were left out of the issue, and why (public repository). */
  filesNote?: string;
};
export type PreviewResult = { ok: true; items: PlanItem[]; account: string } | { ok: false; error: string };

export type PushOutcome = "created" | "updated" | "unchanged" | "missing" | "error" | "blocked";
export type PushItemResult = { id: string; code: string; outcome: PushOutcome; issueNumber?: number; issueUrl?: string; message?: string };
export type ConfirmResult = { ok: true; results: PushItemResult[] } | { ok: false; error: string };

export type GithubLinkInfo = { mode: "push" | "follow"; number: number | null; url: string | null; state: "pending" | "synced" | "error"; error: string | null; ghState: "open" | "closed_completed" | "closed_not_planned" | null; lastActivity: string | null; buildStartedAt?: string | null; buildCompletedAt?: string | null; buildDays?: number | null };

// Sync with GitHub: what the check found (applied already, because GitHub owns these fields) next to what a send would write.
export type ReceivedLine = { label: string; from: string | null; to: string | null };
export type ReceiveStatus = "in_step" | "received" | "not_on_github" | "follows" | "missing" | "error";
export type ReceiveItem = { id: string; code: string; name: string; status: ReceiveStatus; /** The initiative only follows an existing issue: received, never sent. */ readOnly?: boolean; received: ReceivedLine[]; issueNumber: number | null; issueUrl: string | null; message?: string };
export type SyncPreviewResult = { ok: true; account: string; received: ReceiveItem[]; send: PlanItem[] } | { ok: false; error: string };
export type SyncConfirmResult = { ok: true; results: PushItemResult[] } | { ok: false; error: string };
