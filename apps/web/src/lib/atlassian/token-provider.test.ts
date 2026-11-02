import { describe, expect, it } from "vitest";
import type { RefreshOutcome } from "./oauth";
import { getAccessToken, ReconnectNeeded, RefreshBusy, type StoredCredentials, type TokenDeps } from "./token-provider";

function world(initial: StoredCredentials | null, refresh: (rt: string) => RefreshOutcome | Promise<RefreshOutcome>) {
  let creds = initial;
  let lease = false;
  let t = 1_000_000;
  const log = { refreshes: [] as string[], reconnect: 0, stores: 0 };
  const deps: TokenDeps = {
    load: async () => creds,
    claim: async () => (lease ? false : (lease = true)),
    store: async (n) => {
      creds = n;
      lease = false;
      log.stores++;
    },
    refresh: async (rt) => {
      log.refreshes.push(rt);
      return refresh(rt);
    },
    markReconnectNeeded: async () => {
      log.reconnect++;
      lease = false;
    },
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
  return { deps, log, advance: (ms: number) => (t += ms), get creds() { return creds; } };
}
const ok = (n: number): RefreshOutcome => ({ ok: true, accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresIn: 3600 });

describe("Atlassian access token provider", () => {
  it("returns a token that is still valid without touching Atlassian", async () => {
    const w = world({ accessToken: "a0", refreshToken: "r0", expiresAt: 1_000_000 + 3_600_000 }, () => ok(1));
    expect(await getAccessToken(w.deps)).toBe("a0");
    expect(w.log.refreshes).toEqual([]);
  });
  it("refreshes an expired token and stores both new tokens in one write", async () => {
    const w = world({ accessToken: "a0", refreshToken: "r0", expiresAt: 1_000_000 - 1 }, () => ok(1));
    expect(await getAccessToken(w.deps)).toBe("access-1");
    expect(w.log.refreshes).toEqual(["r0"]);
    expect(w.creds).toMatchObject({ accessToken: "access-1", refreshToken: "refresh-1" });
  });
  it("two callers at once refresh only once: the second waits and uses what the first stored", async () => {
    const w = world({ accessToken: "a0", refreshToken: "r0", expiresAt: 1_000_000 - 1 }, async () => {
      await Promise.resolve();
      return ok(1);
    });
    const [a, b] = await Promise.all([getAccessToken(w.deps), getAccessToken(w.deps)]);
    expect([a, b]).toEqual(["access-1", "access-1"]);
    expect(w.log.refreshes).toEqual(["r0"]);
  });
  it("a request that wins the lease just after another stored new tokens does not refresh again", async () => {
    const w = world({ accessToken: "a0", refreshToken: "r0", expiresAt: 1_000_000 - 1 }, () => ok(9));
    const originalLoad = w.deps.load;
    let calls = 0;
    w.deps.load = async () => {
      calls++;
      return calls === 1 ? { accessToken: "a0", refreshToken: "r0", expiresAt: 1_000_000 - 1 } : { accessToken: "a-new", refreshToken: "r-new", expiresAt: 1_000_000 + 3_600_000 };
    };
    expect(await getAccessToken(w.deps)).toBe("a-new");
    expect(w.log.refreshes).toEqual([]);
    w.deps.load = originalLoad;
  });
  it("marks the connection reconnect-needed when Atlassian refuses the grant", async () => {
    const w = world({ accessToken: "a0", refreshToken: "r0", expiresAt: 0 }, () => ({ ok: false, status: 403, reconnect: true }));
    await expect(getAccessToken(w.deps)).rejects.toBeInstanceOf(ReconnectNeeded);
    expect(w.log.reconnect).toBe(1);
  });
  it("does not mark reconnect for a temporary Atlassian error", async () => {
    const w = world({ accessToken: "a0", refreshToken: "r0", expiresAt: 0 }, () => ({ ok: false, status: 503, reconnect: false }));
    await expect(getAccessToken(w.deps)).rejects.toThrow(/503/);
    expect(w.log.reconnect).toBe(0);
  });
  it("needs a reconnect when there is no refresh token or no credentials", async () => {
    const none = world(null, () => ok(1));
    await expect(getAccessToken(none.deps)).rejects.toBeInstanceOf(ReconnectNeeded);
    const noRefresh = world({ accessToken: "a0", refreshToken: null, expiresAt: 0 }, () => ok(1));
    await expect(getAccessToken(noRefresh.deps)).rejects.toBeInstanceOf(ReconnectNeeded);
    expect(noRefresh.log.reconnect).toBe(1);
  });
  it("gives up waiting when the other refresh never finishes", async () => {
    const w = world({ accessToken: "a0", refreshToken: "r0", expiresAt: 0 }, () => ok(1));
    await w.deps.claim(); // someone else holds the lease and never stores
    await expect(getAccessToken(w.deps, { waitMs: 1000, stepMs: 200 })).rejects.toBeInstanceOf(RefreshBusy);
    expect(w.log.refreshes).toEqual([]);
  });
});
