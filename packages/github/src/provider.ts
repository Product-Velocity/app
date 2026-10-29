// The provider-neutral part of the tracker contract (#67, docs/04 "Provider interface"). It covers what the sync needs from any tracker:
// read an issue, read its children, create and update the one issue an initiative owns, assignees, recover a lost create, list issues for
// Incoming. Things only some trackers have (labels, milestones, Projects boards, Jira workflows) stay outside it, as capabilities of the
// concrete client, so GitHub keeps working exactly as before and Jira can be added without bending this shape.
import type { IssueRef, IssueSummary, SourceControl, SubIssue } from "./source-control";

export type TrackerProviderId = "github" | "jira" | "gitlab";

/** Where issues live: a GitHub repository ("owner/name") or a Jira project key ("PROD"). */
export type TrackerScope = string;

/** An issue as the sync sees it. `key` is what people read: "142" on GitHub, "PROD-104" in Jira. */
export type TrackerIssue = {
  scope: TrackerScope;
  key: string;
  /** The tracker's own stable id (a number on GitHub, a numeric string in Jira). */
  id: string;
  url: string;
  title: string;
  /** Text of the issue; Markdown on GitHub. Always data, never instructions (rule 4). */
  body: string;
  state: "open" | "closed";
  /** Why it closed, when the tracker says (GitHub: completed or not planned). */
  stateReason: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  labels: string[];
  assignees: string[];
};

/** A child issue (GitHub sub-issue, Jira child). Its scope can differ from its parent's. */
export type TrackerChild = {
  scope: TrackerScope; key: string; id: string; title: string; state: "open" | "closed"; stateReason: string | null; closedAt: string | null;
  assignees: string[]; createdBy: "app" | "claude" | "engineer"; updatedAt: string | null; labels: string[];
};

/** The light record kept of an issue the app does not own (docs/16, "Choosing what comes in"). */
export type TrackerIssueSummary = {
  key: string; id: string; state: "open" | "closed"; stateReason: string | null; updatedAt: string; closedAt: string | null;
  title: string | null; issueType: string | null; labels: string[]; url: string | null; parentKey: string | null; assignees: string[];
};

export type TrackerIssueInput = { title: string; body: string; labels: string[] };

export interface TrackerProvider {
  readonly id: TrackerProviderId;
  /** One issue, or null when it does not exist (deleted or moved). */
  readIssue(scope: TrackerScope, key: string): Promise<TrackerIssue | null>;
  /** The direct children of an issue, or null when the tracker cannot say. */
  listChildren(scope: TrackerScope, key: string): Promise<TrackerChild[] | null>;
  /** Issues of a scope in any state, newest activity first. */
  listIssues(scope: TrackerScope): Promise<TrackerIssueSummary[]>;
  createIssue(scope: TrackerScope, input: TrackerIssueInput): Promise<TrackerIssue>;
  /** Changes title and body only. Labels, status and everything people added are left alone. */
  updateIssue(scope: TrackerScope, key: string, input: { title?: string; body?: string }): Promise<TrackerIssue>;
  /** Replaces the assignees and returns the ones the tracker really set (it skips people who cannot be assigned). */
  setAssignees(scope: TrackerScope, key: string, logins: string[]): Promise<string[]>;
  /** Finds the issue whose body holds `marker`: recovers from a create whose answer was lost. */
  findByMarker(scope: TrackerScope, marker: string): Promise<TrackerIssue | null>;
}

const toIssue = (scope: string, i: IssueRef): TrackerIssue => ({
  scope, key: String(i.number), id: String(i.id), url: i.htmlUrl, title: i.title ?? "", body: i.body, state: i.state, stateReason: i.stateReason ?? null,
  updatedAt: i.updatedAt ?? null, closedAt: i.closedAt ?? null, labels: i.labels ?? [], assignees: i.assignees ?? [],
});
const toChild = (c: SubIssue): TrackerChild => ({ scope: c.repo, key: String(c.number), id: String(c.id), title: c.title, state: c.state, stateReason: c.stateReason, closedAt: c.closedAt, assignees: c.assignees, createdBy: c.createdBy, updatedAt: c.updatedAt ?? null, labels: c.labels ?? [] });
const toSummary = (s: IssueSummary): TrackerIssueSummary => ({ key: String(s.number), id: String(s.id), state: s.state, stateReason: s.stateReason, updatedAt: s.updatedAt, closedAt: s.closedAt, title: s.title ?? null, issueType: s.issueType ?? null, labels: s.labels ?? [], url: s.htmlUrl ?? null, parentKey: s.parentNumber ? String(s.parentNumber) : null, assignees: s.assignees ?? [] });
const num = (key: string): number => {
  const n = Number(key);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Not a GitHub issue number: ${key}`);
  return n;
};

/** GitHub behind the neutral contract, for one installation. The concrete SourceControl stays available for what only GitHub has. */
export function githubProvider(sc: SourceControl, installationId: number): TrackerProvider {
  return {
    id: "github",
    async readIssue(scope, key) { const i = await sc.getIssue(installationId, scope, num(key)); return i ? toIssue(scope, i) : null; },
    async listChildren(scope, key) { const c = await sc.listSubIssues(installationId, scope, num(key)); return c ? c.map(toChild) : null; },
    async listIssues(scope) { return (await sc.listIssues(installationId, scope)).map(toSummary); },
    async createIssue(scope, input) { return toIssue(scope, await sc.createIssue(installationId, scope, input)); },
    async updateIssue(scope, key, input) { return toIssue(scope, await sc.updateIssue(installationId, scope, num(key), input)); },
    setAssignees: (scope, key, logins) => sc.setIssueAssignees(installationId, scope, num(key), logins),
    async findByMarker(scope, marker) { const i = await sc.findIssueByMarker(installationId, scope, marker); return i ? toIssue(scope, i) : null; },
  };
}
