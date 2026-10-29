export type PullState = "not_pulled" | "pulled" | "ignored";
/** Who owns a pulled-in item: read only (it follows the issue) or Product Velocity (what the initiative is gets sent after a preview and a confirmation). */
export type Ownership = "follow" | "push";

/** The light record of a tracker issue the app has seen but that is not (yet) an initiative. */
export type IncomingIssue = {
  id: string;
  repo: string;
  number: number;
  title: string;
  issueType: string | null;
  labels: string[];
  state: "open" | "closed";
  parentNumber: number | null;
  url: string | null;
  pullState: PullState;
  ignoreReason: string | null;
  itemId: string | null;
  updatedAt: string | null;
};

export type IncomingRule = { id: string; kind: "type" | "label" | "repo"; value: string };

export type BatchOutcome = { id: string; ok: boolean; reason: string | null; itemId?: string | null; itemCode?: string | null };
export type RuleResult = { ok: true } | { ok: false; error: string };

/** What the Incoming list needs from the data layer (Supabase in the app, memory in the test page). */
export interface IncomingSource {
  load(): Promise<{ connectionId: string; issues: IncomingIssue[]; rules: IncomingRule[] }>;
  setState(ids: string[], state: "not_pulled" | "ignored", reason: string | null): Promise<BatchOutcome[]>;
  pullIn(ids: string[], projectId: string, ownership: Ownership): Promise<BatchOutcome[]>;
  /** Undo of a pull-in: the new initiatives are discarded again. */
  discardItems(itemIds: string[]): Promise<{ ok: boolean; error?: string }>;
  addRule(connectionId: string, kind: IncomingRule["kind"], value: string): Promise<RuleResult>;
  removeRule(ruleId: string): Promise<RuleResult>;
}

export const RULE_LABEL: Record<IncomingRule["kind"], string> = { type: "Issue type is", label: "Label is", repo: "Repository is" };
