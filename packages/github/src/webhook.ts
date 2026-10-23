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
