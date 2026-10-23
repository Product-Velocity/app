import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time check of GitHub's X-Hub-Signature-256 header. */
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const INSTALLATION_ACTIONS = ["created", "deleted", "suspend", "unsuspend", "new_permissions_accepted"] as const;
export type InstallationAction = (typeof INSTALLATION_ACTIONS)[number];
const isInstallationAction = (a: unknown): a is InstallationAction => (INSTALLATION_ACTIONS as readonly unknown[]).includes(a);

export type ConnectionEvent =
  | { kind: "installation"; action: InstallationAction; installationId: number; accountLogin: string; accountType: "Organization" | "User"; repositorySelection: "all" | "selected" }
  | { kind: "repositories"; action: "added" | "removed"; installationId: number; accountLogin: string; accountType: "Organization" | "User"; repositorySelection: "all" | "selected" };

type Payload = {
  action?: unknown;
  repository_selection?: unknown;
  installation?: { id?: unknown; account?: { login?: unknown; type?: unknown }; repository_selection?: unknown };
};

/** Reads only the fields the connection needs. Anything else (issues, PRs, ...) returns null and is ignored. */
export function parseConnectionEvent(event: string | null, payload: unknown): ConnectionEvent | null {
  if (event !== "installation" && event !== "installation_repositories") return null;
  const p = payload as Payload;
  const inst = p?.installation;
  const id = inst?.id;
  const login = inst?.account?.login;
  const type = inst?.account?.type;
  if (typeof id !== "number" || typeof login !== "string" || (type !== "Organization" && type !== "User")) return null;
  const sel = p.repository_selection ?? inst?.repository_selection;
  const repositorySelection = sel === "all" ? "all" : "selected";
  if (event === "installation") {
    return isInstallationAction(p.action)
      ? { kind: "installation", action: p.action, installationId: id, accountLogin: login, accountType: type, repositorySelection }
      : null;
  }
  return p.action === "added" || p.action === "removed"
    ? { kind: "repositories", action: p.action, installationId: id, accountLogin: login, accountType: type, repositorySelection }
    : null;
}

export type ConnectionLite = { id: string; state: string };
export type ConnectionDecision =
  | { kind: "ignore" }
  | { kind: "refresh"; id: string }
  | { kind: "set"; id: string; state: "connected" | "suspended" | "disconnected"; adoptInstallation: boolean };

/**
 * What a delivery does to the workspace's connection. `bound` is the open connection already holding this installation;
 * `pending` are open connections still waiting for an installation whose expected account matches the event's account.
 * Replaying a delivery gives the same decision, and an event nobody is waiting for changes nothing.
 */
export function decideConnectionChange(ev: ConnectionEvent, bound: ConnectionLite | null, pending: ConnectionLite[]): ConnectionDecision {
  if (ev.kind === "repositories") return bound?.state === "connected" ? { kind: "refresh", id: bound.id } : { kind: "ignore" };
  if (ev.action === "deleted") return bound ? { kind: "set", id: bound.id, state: "disconnected", adoptInstallation: false } : { kind: "ignore" };
  if (ev.action === "suspend") return bound ? { kind: "set", id: bound.id, state: "suspended", adoptInstallation: false } : { kind: "ignore" };
  // created, unsuspend, new_permissions_accepted
  if (bound) return { kind: "set", id: bound.id, state: "connected", adoptInstallation: false };
  // two workspaces waiting for the same organisation cannot be told apart here: the install-return route binds those
  return pending.length === 1 ? { kind: "set", id: pending[0]!.id, state: "connected", adoptInstallation: true } : { kind: "ignore" };
}

export type IssueEvent = {
  action: string;
  installationId: number;
  repo: string;
  number: number;
  issueId: number;
  nodeId: string;
  state: "open" | "closed";
  stateReason: string | null;
  updatedAt: string;
  closedAt: string | null;
  /** The light record of docs/16 (title, type, labels, link, parent) for the Incoming list. Bodies, comments and people are never read. */
  title: string;
  issueType: string | null;
  labels: string[];
  htmlUrl: string | null;
  parentNumber: number | null;
};

/** The few fields of an `issues` delivery the sync needs. Bodies, comments and people are never read. */
export function parseIssueEvent(event: string | null, payload: unknown): IssueEvent | null {
  if (event !== "issues") return null;
  const p = payload as { action?: unknown; installation?: { id?: unknown }; repository?: { full_name?: unknown }; issue?: { number?: unknown; id?: unknown; node_id?: unknown; state?: unknown; state_reason?: unknown; updated_at?: unknown; closed_at?: unknown; pull_request?: unknown; title?: unknown; html_url?: unknown; type?: { name?: unknown } | null; labels?: { name?: unknown }[]; parent_issue_url?: unknown } };
  const i = p?.issue;
  if (typeof p?.action !== "string" || typeof p.installation?.id !== "number" || typeof p.repository?.full_name !== "string") return null;
  if (!i || i.pull_request || typeof i.number !== "number" || typeof i.id !== "number" || typeof i.node_id !== "string" || typeof i.updated_at !== "string" || Number.isNaN(Date.parse(i.updated_at))) return null;
  if (i.state !== "open" && i.state !== "closed") return null;
  return { action: p.action, installationId: p.installation.id, repo: p.repository.full_name, number: i.number, issueId: i.id, nodeId: i.node_id, state: i.state, stateReason: typeof i.state_reason === "string" ? i.state_reason : null, updatedAt: i.updated_at, closedAt: typeof i.closed_at === "string" ? i.closed_at : null,
    title: typeof i.title === "string" ? i.title.slice(0, 300) : "", issueType: typeof i.type?.name === "string" ? i.type.name : null,
    labels: (Array.isArray(i.labels) ? i.labels : []).map((l) => l?.name).filter((n): n is string => typeof n === "string").slice(0, 30),
    htmlUrl: typeof i.html_url === "string" && i.html_url.startsWith("https://") ? i.html_url : null,
    parentNumber: typeof i.parent_issue_url === "string" ? Number(i.parent_issue_url.split("/").pop()) || null : null };
}

export type SubIssueEvent = { action: string; installationId: number; repo: string; parentNumber: number };

/** A `sub_issues` delivery says which parent issue changed; only its repository and number are read. */
export function parseSubIssueEvent(event: string | null, payload: unknown): SubIssueEvent | null {
  if (event !== "sub_issues") return null;
  const p = payload as { action?: unknown; installation?: { id?: unknown }; repository?: { full_name?: unknown }; parent_issue_repo?: { full_name?: unknown }; parent_issue?: { number?: unknown } };
  const repo = p?.parent_issue_repo?.full_name ?? p?.repository?.full_name;
  if (typeof p?.action !== "string" || typeof p.installation?.id !== "number" || typeof repo !== "string" || typeof p.parent_issue?.number !== "number") return null;
  return { action: p.action, installationId: p.installation.id, repo, parentNumber: p.parent_issue.number };
}
