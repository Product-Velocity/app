import { createHash } from "node:crypto";
import { compareTexts, type TextVerdict } from "./inbound";

// Assignees of the tracking issue against the people assigned in Product Velocity, matched through the GitHub username of each member.
// Only people who can be matched are compared: a GitHub login that no member uses is left alone (never removed, never taken over), and a
// Product Velocity assignee without a username cannot be written to GitHub. Pure, so the rules are tested without GitHub or a database.

export type Member = { userId: string; login: string | null; label: string };

const lower = (s: string) => s.trim().toLowerCase();
const sortedUnique = (xs: readonly string[]) => [...new Set(xs.map(lower).filter(Boolean))].sort();
export const hashAssignees = (logins: readonly string[]) => createHash("sha256").update(sortedUnique(logins).join(",")).digest("hex");

export type AssigneeCompare = {
  verdict: TextVerdict;
  /** Logins of the Product Velocity assignees who have a username, and the GitHub logins that belong to a member. */
  pvLogins: string[];
  ghMapped: string[];
  /** GitHub logins nobody in the workspace uses: shown, never changed. */
  ghUnmapped: string[];
  /** Product Velocity assignees without a username: they cannot be written to GitHub. */
  pvNoLogin: string[];
  pvText: string;
  githubText: string;
  pvHash: string;
  ghHash: string;
  /** What Keep Product Velocity writes to the issue: the unmapped logins that are there, plus the Product Velocity assignees. */
  writeLogins: string[];
  /** What Keep GitHub stores in Product Velocity: the members matched to GitHub's logins, plus the Product Velocity assignees without a username. */
  pullUserIds: string[];
};

export function compareAssignees(i: { members: readonly Member[]; pvIds: readonly string[]; ghLogins: readonly string[]; base?: string; pvUnchanged?: boolean }): AssigneeCompare {
  const byLogin = new Map(i.members.filter((m) => m.login).map((m) => [lower(m.login!), m]));
  const byId = new Map(i.members.map((m) => [m.userId, m]));
  const pv = [...new Set(i.pvIds)].map((id) => byId.get(id)).filter((m): m is Member => !!m);
  const pvWith = pv.filter((m) => m.login);
  const pvLogins = sortedUnique(pvWith.map((m) => m.login!));
  const gh = sortedUnique(i.ghLogins);
  const ghMapped = gh.filter((l) => byLogin.has(l));
  const ghUnmapped = gh.filter((l) => !byLogin.has(l));
  const pvHash = hashAssignees(pvLogins);
  const ghHash = hashAssignees(ghMapped);
  const base = i.base ?? (i.pvUnchanged ? pvHash : undefined);
  // nobody assigned in Product Velocity and somebody in GitHub: only GitHub has anything to say
  const verdict: TextVerdict = pv.length === 0 && ghMapped.length > 0 ? "github" : compareTexts(base, pvHash, ghHash);
  const label = (login: string) => byLogin.get(login)!.label;
  return {
    verdict, pvLogins, ghMapped, ghUnmapped, pvNoLogin: pv.filter((m) => !m.login).map((m) => m.label), pvHash, ghHash,
    pvText: pv.map((m) => m.label).join(", "),
    githubText: ghMapped.map(label).join(", "),
    writeLogins: sortedUnique([...ghUnmapped, ...pvLogins]),
    pullUserIds: [...new Set([...ghMapped.map((l) => byLogin.get(l)!.userId), ...pv.filter((m) => !m.login).map((m) => m.userId)])].sort(),
  };
}

/** What a write to the issue changes, in logins: the ones added and the ones removed (for the preview and the result). */
export function assigneeChange(current: readonly string[], next: readonly string[]): { add: string[]; remove: string[] } {
  const cur = new Set(sortedUnique(current));
  const nxt = new Set(sortedUnique(next));
  return { add: [...nxt].filter((l) => !cur.has(l)), remove: [...cur].filter((l) => !nxt.has(l)) };
}
