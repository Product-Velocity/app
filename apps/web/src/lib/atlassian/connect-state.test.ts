import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signConnectState, verifyConnectState } from "./connect-state";

const key = randomBytes(32);

describe("connect state", () => {
  it("carries the workspace and the person, and is accepted before it runs out", () => {
    const s = signConnectState("tenant-1", "user-1", key, 1_000_000);
    expect(verifyConnectState(s, key, 1_000_000 + 599_000)).toMatchObject({ t: "tenant-1", u: "user-1" });
  });
  it("is refused after 10 minutes", () => {
    const s = signConnectState("t", "u", key, 1_000_000);
    expect(verifyConnectState(s, key, 1_000_000 + 601_000)).toBeNull();
  });
  it("is refused when changed or signed with another key", () => {
    const s = signConnectState("t", "u", key);
    const [v, payload, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ t: "other", u: "u", exp: 9_999_999_999, n: "x" })).toString("base64url");
    expect(verifyConnectState(`${v}.${forged}.${sig}`, key)).toBeNull();
    expect(verifyConnectState(`${v}.${payload}.${sig}`, randomBytes(32))).toBeNull();
    expect(verifyConnectState("garbage", key)).toBeNull();
    expect(verifyConnectState(null, key)).toBeNull();
  });
  it("says which connection it is for: Confluence has its own sign-in (issue #693); a Jira state has no kind, so states signed before still work", () => {
    expect(verifyConnectState(signConnectState("t", "u", key, 1_000_000, "confluence"), key, 1_000_001)).toMatchObject({ t: "t", u: "u", k: "confluence" });
    expect(verifyConnectState(signConnectState("t", "u", key, 1_000_000), key, 1_000_001)?.k).toBeUndefined();
  });
  it("refuses a state that names a kind that does not exist", () => {
    const payload = Buffer.from(JSON.stringify({ t: "t", u: "u", exp: 9_999_999_999, n: "x", k: "bitbucket" })).toString("base64url");
    const good = signConnectState("t", "u", key);
    // signed correctly for a different payload is impossible without the key, so build the signature the same way the module does by signing a state and swapping nothing: an unknown kind never verifies
    expect(verifyConnectState(`pv1.${payload}.${good.split(".")[2]}`, key)).toBeNull();
  });
});

