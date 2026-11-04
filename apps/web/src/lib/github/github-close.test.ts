import { describe, expect, it } from "vitest";
import { GitHubError, MemorySourceControl } from "@pv/github";
import { classify, closeNotPlanned, readCloseState, stateWords, withBackoff } from "./github-close";
import { restoredAfterCloseNote } from "./removed-note";

const sc = (state: "open" | "closed" = "open") => {
  const m = new MemorySourceControl();
  m.issues.set("acme/road#7", { number: 7, id: 70, nodeId: "n7", htmlUrl: "https://github.com/acme/road/issues/7", body: "", state, title: "T", labels: ["bug"] });
  return m;
};
const T = (m: MemorySourceControl, o: { repo?: string; number?: number } = {}) => ({ sc: m, installationId: 1, repo: o.repo ?? "acme/road", number: o.number ?? 7 });

describe("classify", () => {
  it("says what to do for each failure, without a response body", () => {
    expect(classify(new GitHubError(401, "x"))).toMatchObject({ kind: "reconnect", message: expect.stringContaining("Reconnect GitHub") });
    expect(classify(new GitHubError(403, "x"))).toMatchObject({ kind: "permission", message: expect.stringContaining("Issues permission") });
    expect(classify(new GitHubError(403, "x", 30))).toMatchObject({ kind: "rate_limited", message: expect.stringContaining("30 seconds") });
    expect(classify(new GitHubError(429, "x"))).toMatchObject({ kind: "rate_limited" });
    expect(classify(new GitHubError(404, "x"))).toMatchObject({ kind: "gone" });
    expect(classify(new GitHubError(422, "secret body"))).toMatchObject({ kind: "rejected", message: "GitHub refused it (422)." });
    expect(classify(new GitHubError(502, "x"))).toMatchObject({ kind: "unavailable" });
    expect(classify(new Error("GitHub refused to create an installation token (404)"))).toMatchObject({ kind: "reconnect" });
    expect(classify(new Error("boom ghs_abc123"))).toMatchObject({ kind: "unavailable", message: "GitHub could not be reached. Try again." });
  });
});

describe("withBackoff", () => {
  it("waits out a short limit at most twice, then gives up; a long limit is not waited out", async () => {
    let n = 0;
    const waits: number[] = [];
    const r = await withBackoff(async () => { n++; throw new GitHubError(429, "x", 2); }, async (ms) => { waits.push(ms); });
    expect(r).toMatchObject({ ok: false, kind: "rate_limited" });
    expect(n).toBe(3);
    expect(waits).toEqual([2000, 2000]);
    let m = 0;
    await withBackoff(async () => { m++; throw new GitHubError(429, "x", 300); }, async () => { throw new Error("no wait"); });
    expect(m).toBe(1);
  });
  it("does not retry other failures", async () => {
    let n = 0;
    await withBackoff(async () => { n++; throw new GitHubError(500, "x"); });
    expect(n).toBe(1);
  });
});

describe("the writes", () => {
  it("refuse anything that is not a repository and an issue number, before a call", async () => {
    const m = sc();
    expect(await readCloseState(T(m, { repo: "../etc/passwd" }))).toMatchObject({ ok: false });
    expect(await readCloseState(T(m, { number: 0 }))).toMatchObject({ ok: false });
    expect(m.calls).toEqual([]);
  });
  it("closing needs the issue to be open in the state just read: a closed issue is not closed again, a failed read closes nothing", async () => {
    const m = sc("closed");
    const closed = await readCloseState(T(m));
    expect((await closeNotPlanned(T(m), closed)).ok).toBe(false);
    expect(await closeNotPlanned(T(m), { ok: false, kind: "gone", message: "x" })).toMatchObject({ ok: false });
    expect(m.calls).toEqual(["getIssue"]);
  });
});

describe("words", () => {
  it("states", () => {
    expect(stateWords("open", null)).toBe("open");
    expect(stateWords("closed", "not_planned")).toBe("closed as not planned");
    expect(stateWords("closed", "completed")).toBe("closed as completed");
    expect(stateWords("closed", null)).toBe("closed as completed");
  });
  it("the note for a restored initiative: said when something was done to the issue, not for an issue that was not found; it says nothing is reopened", () => {
    expect(restoredAfterCloseNote("acme/road#7", "closed")).toContain("labelled “pv:removed” and is closed");
    expect(restoredAfterCloseNote("acme/road#7", "closed")).toContain("does not reopen it");
    expect(restoredAfterCloseNote("acme/road#7", "not_found")).toBeNull();
    expect(restoredAfterCloseNote("acme/road#7", null)).toBeNull();
  });
});
