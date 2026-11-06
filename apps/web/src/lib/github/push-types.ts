// Shapes shared by the push server actions and the dialog (no server-only code here).
export const PUSH_LIMIT = 25;

export type PlanAction = "create" | "update" | "unchanged" | "blocked";
export type PlanItem = {
  id: string;
  /** Which tracker this send goes to; absent means GitHub. For Jira `repo` holds the Jira project key and `issueLabel` the issue key. */
  tracker?: "github" | "jira";
  issueLabel?: string;
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
  /** What was left out or will be replaced, in words (Jira: an unmapped field, a rich description that is replaced). */
  notes?: string[];
};
export type PreviewResult = { ok: true; items: PlanItem[]; account: string } | { ok: false; error: string };

export type PushOutcome = "created" | "updated" | "unchanged" | "missing" | "error" | "blocked";
export type PushItemResult = { id: string; code: string; outcome: PushOutcome; issueNumber?: number; /** Jira: the issue key, shown instead of "issue #number". */ issueLabel?: string; issueUrl?: string; message?: string };
export type ConfirmResult = { ok: true; results: PushItemResult[] } | { ok: false; error: string };

export type GithubLinkInfo = { mode: "push" | "follow"; number: number | null; url: string | null; state: "pending" | "synced" | "error"; error: string | null; ghState: "open" | "closed_completed" | "closed_not_planned" | null; lastActivity: string | null; buildStartedAt?: string | null; buildCompletedAt?: string | null; buildDays?: number | null };

// Sync with GitHub: what the check found (applied already, because GitHub owns those fields) next to what a send would write.
export type ReceivedLine = { label: string; from: string | null; to: string | null };
export type ReceiveStatus = "in_step" | "received" | "conflict" | "not_on_github" | "not_linked" | "follows" | "missing" | "error";
/** A text that Product Velocity owns and that differs from GitHub. `github`: changed only in GitHub; `both`: changed on both sides; `block`: the managed block cannot be read field by field. */
export type SyncConflict = {
  field: "title" | "summary" | "description" | "hypothesis" | "block" | "priority" | "group" | "due" | "size" | "assignees";
  label: string;
  kind: "github" | "both" | "block";
  pv: string;
  github: string;
  /** Hash of GitHub's text when it was read; the confirm compares it with a fresh read. */
  ghHash: string;
  /** Keep Product Velocity for a change made only in GitHub; no default when both changed or the block is unreadable. */
  defaultChoice: "pv" | "github" | null;
  note?: string;
  /** The value lives on the GitHub Project board, not in the issue. */
  where?: "board";
  /** False when the board's value cannot be taken over (for example an unknown priority): only Keep Product Velocity is offered. */
  githubPullable?: false;
  /** False when Product Velocity's value cannot be written to GitHub (assignees on a public repository): only Keep GitHub is offered. */
  pvPossible?: false;
};
/** `choice` "github" means "the tracker's text" (Keep Jira for a Jira initiative); `ghHash` is the hash of the tracker's text at the preview. */
export type SyncChoice = { itemId: string; field: SyncConflict["field"]; choice: "pv" | "github"; ghHash: string };
export type ReceiveItem = { id: string; code: string; name: string; status: ReceiveStatus; /** Which tracker answered; absent means GitHub. Jira cards only receive: sending to Jira is not built yet. */ tracker?: "github" | "jira"; /** The initiative only follows an existing issue: received, never sent. */ readOnly?: boolean; received: ReceivedLine[]; conflicts?: SyncConflict[]; /** Assignees a send would add to or remove from the issue (Product Velocity changed them, GitHub did not). */ assigneeSend?: { add: string[]; remove: string[] }; issueNumber: number | null; /** How a tracker without issue numbers names the issue (Jira: PLAT-12); shown instead of "#number". */ issueLabel?: string; issueUrl: string | null; message?: string };
export type SyncPreview = { account: string; received: ReceiveItem[]; send: PlanItem[] };
export type SyncPreviewResult = ({ ok: true } & SyncPreview) | { ok: false; error: string };
/** A text taken over from GitHub: what the grid shows and what one undo step puts back. */
export type TakenOver = { itemId: string; code: string; field: "initiative_name" | "summary" | "description" | "hypothesis" | "moscow" | "theme" | "end_date" | "effort"; before: string | null; after: string | null };
export type SyncConfirmResult =
  | { ok: true; results: PushItemResult[]; taken: TakenOver[] }
  /** `stale`: GitHub changed after the preview; nothing was applied or sent and the new difference is returned. */
  | { ok: false; error: string; stale?: SyncPreview };

// "Removed in Product Velocity" in Sync with Jira and Sync with GitHub (decisions 2026-11-03-jira-close-removed and 2026-11-03-github-close-removed):
// initiatives that were deleted (Trash) and whose tracker issue Product Velocity owns. The person confirms each one; nothing is written before.
// Both trackers use these shapes and the same section component; a GitHub card has no `options` (nothing to choose: it is closed as "not planned").
export type RemovedCard = {
  /** Which tracker the issue is in; absent means Jira. */
  tracker?: "github" | "jira";
  id: string;
  code: string;
  name: string;
  /** The issue was adopted from the tracker, not created by Product Velocity: closing it ends real work there. The preview warns in red and leaves it unticked. */
  adopted?: true;
  /** The initiative was stopped at a decision gate (Cancelled), not deleted: the preview says so. */
  stopped?: { gate: string };
  issueKey: string;
  issueUrl: string | null;
  /** ready: can be confirmed. error: could not be read (nothing is offered to write). gone: the tracker does not return the issue. */
  state: "ready" | "error" | "gone";
  message?: string;
  /** The current Jira status (text from Jira) and whether it is already in a Done category. For a GitHub card `alreadyDone` means the issue is closed already and `trackerStatus` says how. */
  jiraStatus?: string;
  trackerStatus?: string;
  alreadyDone?: boolean;
  /** The workflow transitions into a Done status. Empty and not already done: only the label can be added. */
  options: { id: string; name: string; toStatusName: string }[];
  /** The transition used when the person does not choose: the only one, or the one into the Done status chosen before for this Jira project. */
  defaultTransitionId: string | null;
};
export type RemovedList = { ok: true; items: RemovedCard[]; /** How many more removed initiatives wait (the list is cut at 25). */ more: number } | { ok: false; error: string };
export type RemovedOutcome = "closed" | "labeled" | "already_done" | "not_found" | "error";
export type RemovedResult = { id: string; code: string; outcome: RemovedOutcome; issueLabel?: string; issueUrl?: string; message?: string };
export type RemovedApi = {
  list(): Promise<RemovedList>;
  /** Labels and closes ONE initiative's issue after the person confirmed. `transitionId` null: the default one (GitHub has none: always null). */
  close(id: string, transitionId: string | null): Promise<{ ok: true; result: RemovedResult } | { ok: false; error: string }>;
};
