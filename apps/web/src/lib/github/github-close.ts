import { GitHubError, LABEL_COLOUR, REMOVED_LABEL, type IssueRef, type SourceControl } from "@pv/github";

// Closing the GitHub issue of an initiative that was removed in Product Velocity (decision 2026-11-03-github-close-removed; the twin of
// lib/atlassian/jira-close.ts). THIS IS THE ONLY MODULE THAT MAY CLOSE A GITHUB ISSUE, and only github-removed-engine.ts may import it (a test fails
// otherwise): CLAUDE.md rule 6 says status is tracker-driven, and Ashu's exception is exactly one thing: an explicit, confirmed, per-initiative close of an
// issue Product Velocity owns, after the initiative was deleted. Two writes exist here: add the label `pv:removed` (every other label stays: GitHub's
// "add labels" keeps them) and close the issue as "not planned" (`state_reason`). The payload carries no field of the initiative at all (rule 2). There is
// no delete, no reopen, no comment. Pure over an injected SourceControl and sleep, so it is tested with a fake GitHub.

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** What is written to one issue: where it is, and the installation that may write there. */
export type Target = { sc: SourceControl; installationId: number; repo: string; number: number };

export type CloseFail = { ok: false; kind: "reconnect" | "permission" | "rate_limited" | "rejected" | "unavailable" | "gone"; message: string };
export type CloseState =
  | { ok: true; state: "open" | "closed"; stateReason: string | null; labels: string[] }
  | { ok: false; kind: CloseFail["kind"]; message: string };

const RECONNECT = "GitHub did not accept the app's credentials (the installation token expired, or the app was removed). Reconnect GitHub (Settings, Integrations, GitHub). Nothing was written.";
const PERMISSION = "The GitHub App may not change issues in this repository: it needs the Issues permission with write access. Check the app's permissions (Settings, Integrations, GitHub) and approve them on GitHub. Nothing was written.";
const GONE = "GitHub no longer has this issue (deleted, transferred or not visible to the app). Nothing was changed.";

/** A failure as a short message that is safe to show: never a response body, never a token. */
export function classify(e: unknown): CloseFail {
  if (e instanceof GitHubError) {
    if (e.status === 401) return { ok: false, kind: "reconnect", message: RECONNECT };
    if (e.status === 429 || (e.status === 403 && e.retryAfterSeconds)) return { ok: false, kind: "rate_limited", message: `GitHub is limiting requests right now. Try again in about ${e.retryAfterSeconds ?? 60} seconds.` };
    if (e.status === 403) return { ok: false, kind: "permission", message: PERMISSION };
    if (e.status === 404 || e.status === 410) return { ok: false, kind: "gone", message: GONE };
    if (e.status >= 500) return { ok: false, kind: "unavailable", message: "GitHub had a problem. Try again." };
    return { ok: false, kind: "rejected", message: `GitHub refused it (${e.status}).` };
  }
  // the installation token could not be made: the app was uninstalled, suspended, or its key no longer fits
  const m = e instanceof Error ? /installation token \((\d{3})\)/.exec(e.message) : null;
  if (m) return { ok: false, kind: [401, 403, 404].includes(Number(m[1])) ? "reconnect" : "unavailable", message: [401, 403, 404].includes(Number(m[1])) ? RECONNECT : "GitHub had a problem. Try again." };
  return { ok: false, kind: "unavailable", message: "GitHub could not be reached. Try again." };
}

/**
 * Runs a GitHub call; a rate limit is waited out when GitHub says it is short (at most twice, at most 10 seconds each), the way a person would try again.
 * A longer one stops with the time GitHub gave. Other failures are returned, never retried.
 */
export async function withBackoff<T>(f: () => Promise<T>, sleep: Sleep = realSleep): Promise<{ ok: true; value: T } | CloseFail> {
  for (let attempt = 0; ; attempt++) {
    try {
      return { ok: true, value: await f() };
    } catch (e) {
      const c = classify(e);
      const wait = e instanceof GitHubError ? (e.retryAfterSeconds ?? 0) : 0;
      if (c.kind === "rate_limited" && attempt < 2 && wait > 0 && wait <= 10) { await sleep(wait * 1000); continue; }
      return c;
    }
  }
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const bad = (t: Target): CloseFail | null => (!REPO.test(t.repo) || !Number.isInteger(t.number) || t.number < 1 ? { ok: false, kind: "rejected", message: "That is not a GitHub issue." } : null);

/** Reads (no write): the issue's state, why it closed, and its labels. */
export async function readCloseState(t: Target, sleep?: Sleep): Promise<CloseState> {
  const refused = bad(t);
  if (refused) return { ...refused, kind: "gone" };
  const r = await withBackoff(() => t.sc.getIssue(t.installationId, t.repo, t.number), sleep);
  if (!r.ok) return r.kind === "rejected" ? { ...r, kind: "unavailable" } : r;
  if (!r.value) return { ok: false, kind: "gone", message: GONE };
  const i: IssueRef = r.value;
  return { ok: true, state: i.state, stateReason: i.stateReason ?? null, labels: i.labels ?? [] };
}

/** Adds the label `pv:removed` and nothing else: "add labels" keeps every other label. The label is created in the repository first when it is missing. */
export async function addRemovedLabel(t: Target, sleep?: Sleep): Promise<{ ok: true } | CloseFail> {
  const refused = bad(t);
  if (refused) return refused;
  const r = await withBackoff(async () => {
    await t.sc.ensureLabels(t.installationId, t.repo, [{ name: REMOVED_LABEL, color: LABEL_COLOUR, description: "Managed by Product Velocity: the initiative was removed" }]);
    await t.sc.addLabels(t.installationId, t.repo, t.number, [REMOVED_LABEL]);
  }, sleep);
  return r.ok ? { ok: true } : r;
}

/** Closes the issue as "not planned". Refuses an issue that is closed already (checked against `current`, read just before): nothing is reopened or rewritten. */
export async function closeNotPlanned(t: Target, current: CloseState, sleep?: Sleep): Promise<{ ok: true } | CloseFail> {
  const refused = bad(t);
  if (refused) return refused;
  if (!current.ok || current.state !== "open") return { ok: false, kind: "rejected", message: "The issue is not open any more, so it is not closed again." };
  const r = await withBackoff(() => t.sc.closeIssueNotPlanned(t.installationId, t.repo, t.number), sleep);
  return r.ok ? { ok: true } : r;
}

/** The words for the state of an issue, as shown in the preview. Text from GitHub is data: only these fixed phrases are shown. */
export function stateWords(state: "open" | "closed", reason: string | null): string {
  return state === "open" ? "open" : reason === "not_planned" ? "closed as not planned" : reason === "duplicate" ? "closed as a duplicate" : "closed as completed";
}
