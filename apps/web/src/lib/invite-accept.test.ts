import { describe, expect, it } from "vitest";
import { inviteTokenFromNext } from "./invite-accept";

const T = "Ab-_".repeat(11);
describe("inviteTokenFromNext", () => {
  it("reads the token from an invitation path", () => {
    expect(inviteTokenFromNext(`/invite/${T}`)).toBe(T);
    expect(inviteTokenFromNext(`/invite/${T}/`)).toBe(T);
  });
  it("ignores anything else", () => {
    for (const p of ["/invite/short", `/invite/${T}?x=1`, `/other/${T}`, `/invite/${T}/extra`, "/app"]) expect(inviteTokenFromNext(p)).toBeNull();
  });
});
