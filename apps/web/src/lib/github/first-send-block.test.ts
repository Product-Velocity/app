import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { conflictsOf } = await import("./sync-flow");
const { compareIssue } = await import("@pv/github");

const compare = (body: string) => compareIssue({ code: "R-04", pv: { initiative_name: "Host Read Ads IO", summary: "", description: "", hypothesis: "" }, issue: { title: "Host Read Ads IO", body } });
const item = (cmp: ReturnType<typeof compare>, firstSend: boolean) => ({ code: "R-04", cmp, blockHash: "h", firstSend, baseComplete: false, pvHashes: {}, board: [] }) as never;

describe("an adopted issue Product Velocity has never written to (issue #364 follow-up)", () => {
  it("marks a body without our markers as a missing block, not an edited one", () => {
    expect(compare("## Goal\nSomething typed by a person").blockMissing).toBe(true);
    expect(compare("<!-- pv:begin item=00000000-0000-0000-0000-000000000000 -->\nx\n<!-- pv:end -->").blockMissing).toBeUndefined();
  });
  it("is not a conflict before the first send: the send adds the block", () => {
    expect(conflictsOf(item(compare("## Goal\nSomething typed by a person"), true))).toEqual([]);
  });
  it("is still a conflict when a block we wrote has gone missing, so a person decides", () => {
    expect(conflictsOf(item(compare("## Goal\nSomething typed by a person"), false)).map((c) => c.field)).toEqual(["block"]);
  });
  it("is still a conflict when the block was edited, even before a first send", () => {
    const edited = compare("<!-- pv:begin item=broken -->\nx\n<!-- pv:end -->");
    expect(edited.blockMissing).toBeUndefined();
    expect(conflictsOf(item(edited, true)).map((c) => c.field)).toEqual(["block"]);
  });
});
