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
};
export type PreviewResult = { ok: true; items: PlanItem[]; account: string } | { ok: false; error: string };

export type PushOutcome = "created" | "updated" | "unchanged" | "missing" | "error" | "blocked";
export type PushItemResult = { id: string; code: string; outcome: PushOutcome; issueNumber?: number; issueUrl?: string; message?: string };
export type ConfirmResult = { ok: true; results: PushItemResult[] } | { ok: false; error: string };

export type GithubLinkInfo = { number: number | null; url: string | null; state: "pending" | "synced" | "error"; error: string | null };
