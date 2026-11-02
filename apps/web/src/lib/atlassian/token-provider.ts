import type { RefreshOutcome } from "./oauth";

// Gives the rest of the app a usable Atlassian access token for one connection (docs/16, issue #67).
// Atlassian's refresh token ROTATES, so two parallel refreshes with the same token would lose the connection. The rule:
//   1. a token that is still valid for more than a minute is returned as it is;
//   2. otherwise the caller claims the single refresh lease; the one who gets it refreshes and stores BOTH new tokens in one write;
//   3. everyone else waits briefly and re-reads what the winner stored;
//   4. if Atlassian refuses the refresh, the connection is marked "reconnect needed" and the admin is asked to sign in again.
// A process that dies between Atlassian rotating and our store loses the token; the lease then runs out and the next refresh
// is refused, which ends in the same "reconnect needed". Everything below is injected, so it is tested without a network.

export type StoredCredentials = { accessToken: string; refreshToken: string | null; expiresAt: number };

export type TokenDeps = {
  load: () => Promise<StoredCredentials | null>;
  claim: () => Promise<boolean>;
  store: (next: { accessToken: string; refreshToken: string | null; expiresAt: number }) => Promise<void>;
  refresh: (refreshToken: string) => Promise<RefreshOutcome>;
  markReconnectNeeded: () => Promise<void>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export class ReconnectNeeded extends Error {
  constructor() {
    super("The Jira connection needs to be signed in again.");
  }
}
export class RefreshBusy extends Error {
  constructor() {
    super("Another request is refreshing the Jira sign-in; try again in a moment.");
  }
}

const FRESH_MS = 60_000;

export async function getAccessToken(d: TokenDeps, opts: { waitMs?: number; stepMs?: number } = {}): Promise<string> {
  const waitMs = opts.waitMs ?? 5_000;
  const stepMs = opts.stepMs ?? 200;
  const fresh = (c: StoredCredentials | null): boolean => c !== null && c.expiresAt - d.now() > FRESH_MS;

  const first = await d.load();
  if (!first) throw new ReconnectNeeded();
  if (fresh(first)) return first.accessToken;

  if (await d.claim()) {
    // re-read after winning: the previous holder may have stored new tokens just before our claim
    const current = (await d.load()) ?? first;
    if (fresh(current)) return current.accessToken;
    if (!current.refreshToken) {
      await d.markReconnectNeeded();
      throw new ReconnectNeeded();
    }
    const r = await d.refresh(current.refreshToken);
    if (!r.ok) {
      if (r.reconnect) await d.markReconnectNeeded();
      throw r.reconnect ? new ReconnectNeeded() : new Error(`Atlassian refused the refresh (${r.status}).`);
    }
    const expiresAt = d.now() + r.expiresIn * 1000;
    await d.store({ accessToken: r.accessToken, refreshToken: r.refreshToken ?? current.refreshToken, expiresAt });
    return r.accessToken;
  }

  for (let waited = 0; waited < waitMs; waited += stepMs) {
    await d.sleep(stepMs);
    const c = await d.load();
    if (c && fresh(c)) return c.accessToken;
  }
  throw new RefreshBusy();
}
