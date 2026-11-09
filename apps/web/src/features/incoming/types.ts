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

export type BatchOutcome = { id: string; ok: boolean; reason: string | null; itemId?: string | null; itemCode?: string | null; /** A short extra line for the person (for example that an issue's text could not be read). */ note?: string };
/** What a re-pull did: fields that were still empty were filled again from GitHub; nothing that already had a value was changed. */
export type RefreshResult = { ok: true; checked: number; descriptions: number; labelled: number; failed: number } | { ok: false; error: string };
export type RuleResult = { ok: true } | { ok: false; error: string };

/** What the Incoming list needs from the data layer (Supabase in the app, memory in the test page). */
export interface IncomingSource {
  load(): Promise<{ connectionId: string; issues: IncomingIssue[]; rules: IncomingRule[] }>;
  setState(ids: string[], state: "not_pulled" | "ignored", reason: string | null): Promise<BatchOutcome[]>;
  pullIn(ids: string[], projectId: string, ownership: Ownership): Promise<BatchOutcome[]>;
  /** Re-pull: fills the Description, Change Type and Focus Area that are still empty on initiatives already pulled in, from their issue. Optional: only GitHub has it so far (#365 for Jira). */
  refreshPulled?(itemIds: string[]): Promise<RefreshResult>;
  /** Undo of a pull-in: the new initiatives are discarded again. */
  discardItems(itemIds: string[]): Promise<{ ok: boolean; error?: string }>;
  addRule(connectionId: string, kind: IncomingRule["kind"], value: string): Promise<RuleResult>;
  removeRule(ruleId: string): Promise<RuleResult>;
}

export const RULE_LABEL: Record<IncomingRule["kind"], string> = { type: "Issue type is", label: "Label is", repo: "Repository is" };

/** The words and shapes that differ per tracker, so one list serves GitHub and Jira (the data layer maps each tracker's issues into IncomingIssue). */
export type IncomingTerms = {
  /** "GitHub" or "Jira". */
  tracker: string;
  /** What the group filter is called: "Repository" or "Jira project". */
  groupLabel: string;
  /** How an issue is written: "#12" or "PLAT-12". */
  ref: (i: Pick<IncomingIssue, "repo" | "number">) => string;
  /** Saved rules for new arrivals exist for this tracker. */
  rules: boolean;
  /** Each issue goes into the project linked to its own tracker project; the person does not choose. */
  projectFixed: boolean;
  /** Shown when nothing has been read yet. */
  emptyHint: string;
};
export const GITHUB_TERMS: IncomingTerms = { tracker: "GitHub", groupLabel: "Repository", ref: (i) => `#${i.number}`, rules: true, projectFixed: false, emptyHint: "No issues yet. Press “Check GitHub now” above to read them." };
export const JIRA_TERMS: IncomingTerms = { tracker: "Jira", groupLabel: "Jira project", ref: (i) => `${i.repo}-${i.number}`, rules: false, projectFixed: true, emptyHint: "No issues yet. Press “Read Jira now” under Settings, Integrations, Jira." };
