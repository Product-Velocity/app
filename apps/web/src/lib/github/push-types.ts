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
