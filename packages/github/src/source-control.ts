// The provider-neutral contract (docs/04). GitHub implements it today; GitLab must fit behind the same names.

export type InstallationInfo = {
  id: number;
  accountLogin: string;
  accountType: "Organization" | "User";
  repositorySelection: "all" | "selected";
  permissions: Record<string, string>;
  events: string[];
  suspended: boolean;
};

export type RepoInfo = { id: number; fullName: string; private: boolean };

export type DeliverySummary = { event: string; action: string | null; statusCode: number; deliveredAt: string };

export type IssueInput = { title: string; body: string; labels: string[]; /** Organisation issue type name; only sent when the organisation has it. */ type?: string; /** Milestone number in the same repository. */ milestone?: number };
export type IssueRef = { number: number; id: number; nodeId: string; htmlUrl: string; body: string; state: "open" | "closed"; /** The labels on the issue, when GitHub reported them. */ labels?: string[] };

/** An organisation-owned GitHub Project (a "board"). */
export type BoardInfo = { id: string; number: number; title: string; url: string; closed: boolean };
export type BoardField = { id: string; name: string; dataType: "TEXT" | "NUMBER" | "DATE" | "SINGLE_SELECT" | "OTHER"; options?: { id: string; name: string }[] };
/** One issue on a Project board with the board's status for it (the option name, null when none is set). */
export type BoardItemStatus = { itemId: string; issueNodeId: string; repo: string; number: number; status: string | null };
export type BoardValue = { text: string } | { number: number } | { date: string } | { optionId: string };

/** Raised for GitHub errors. Carries the status only: never the response body, headers or any token. */
export class GitHubError extends Error {
  /** GitHub's own short explanation, for errors of the Projects (GraphQL) API and the step that failed; scrubbed of anything token-like. */
  readonly detail?: string;
  constructor(readonly status: number, message: string, readonly retryAfterSeconds?: number, detail?: string) {
    super(message);
    this.name = "GitHubError";
    if (detail) this.detail = detail.replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[token]").replace(/\s+/g, " ").trim().slice(0, 240);
  }
}

/** What the app keeps of an issue it does not own: key, title, type, labels, status, link, parent (the "light record" of docs/16). */
export type IssueSummary = {
  number: number; id: number; nodeId: string; state: "open" | "closed"; stateReason: string | null; updatedAt: string; closedAt: string | null;
  title?: string; issueType?: string | null; labels?: string[]; htmlUrl?: string | null; parentNumber?: number | null;
};

/** A sub-issue as GitHub reports it. `repo` can differ from the parent's repository. */
export type SubIssue = { number: number; id: number; /** GraphQL id, needed to put the issue on a Project board. */ nodeId: string; repo: string; title: string; state: "open" | "closed"; stateReason: string | null; closedAt: string | null; assignees: string[]; createdBy: "app" | "claude" | "engineer" };

export interface SourceControl {
  readonly provider: "github";
  /** The installation, or null when it does not exist (or does not belong to this App). */
  getInstallation(installationId: number): Promise<InstallationInfo | null>;
  /** Every installation of the App (diagnostics only). */
  listInstallations(): Promise<InstallationInfo[]>;
  /** Repositories the installation can reach. Short-lived tokens are created inside and never leave this object. */
  listRepositories(installationId: number): Promise<RepoInfo[]>;
  /** Issue type names of the organisation, or null when the App may not read them. */
  listIssueTypes(installationId: number, organisation: string): Promise<string[] | null>;
  /** Issues of a repository in any state (pull requests excluded), newest activity first. Used to reconcile linked items. */
  listIssues(installationId: number, repo: string): Promise<IssueSummary[]>;
  /** Direct sub-issues of an issue (one level, all pages), or null when sub-issues are not available for it. */
  listSubIssues(installationId: number, repo: string, number: number): Promise<SubIssue[] | null>;
  /** Creates an issue in `repo` ("owner/name"). */
  createIssue(installationId: number, repo: string, input: IssueInput): Promise<IssueRef>;
  /** Updates title and body of an issue. Labels are never replaced: people add their own. */
  updateIssue(installationId: number, repo: string, number: number, input: { title?: string; body?: string; type?: string; milestone?: number }): Promise<IssueRef>;
  /** Adds labels to an issue (idempotent); existing labels stay. */
  addLabels(installationId: number, repo: string, number: number, labels: string[]): Promise<void>;
  /** Removes one label from an issue (a label that is not there is fine). The app only ever removes labels in its own `pv:` namespace. */
  removeLabel(installationId: number, repo: string, number: number, label: string): Promise<void>;
  getIssue(installationId: number, repo: string, number: number): Promise<IssueRef | null>;
  /** Finds an issue whose body contains `marker` (used to recover from a create whose answer was lost). */
  findIssueByMarker(installationId: number, repo: string, marker: string): Promise<IssueRef | null>;
  /** Makes sure the labels exist (an App's labels on a new issue are otherwise dropped silently). */
  ensureLabels(installationId: number, repo: string, labels: { name: string; color: string; description: string }[]): Promise<void>;
  /** The number of the milestone with this title in the repository (open or closed), created with the due date when missing. */
  ensureMilestone(installationId: number, repo: string, milestone: { title: string; dueOn: string }): Promise<number>;
  /** Open and closed organisation-owned Projects of an organisation (needs the Organization "Projects" permission). */
  listBoards(installationId: number, organisation: string): Promise<BoardInfo[]>;
  /** The fields of a Project, or null when it cannot be found. */
  getBoardFields(installationId: number, boardId: string): Promise<BoardField[] | null>;
  /** The issues on a Project (up to 1,000) with the value of the named single-select field (the board's Status). */
  listBoardItems(installationId: number, boardId: string, statusField: string): Promise<BoardItemStatus[]>;
  /** Adds an issue (by its node id) to a Project and returns the Project item id; adding it again returns the same item. */
  addBoardItem(installationId: number, boardId: string, issueNodeId: string): Promise<string>;
  /** Sets one field of a Project item. */
  setBoardValue(installationId: number, boardId: string, itemId: string, fieldId: string, value: BoardValue): Promise<void>;
  /** The newest webhook deliveries the App received, newest first. */
  listRecentDeliveries(): Promise<DeliverySummary[]>;
}
