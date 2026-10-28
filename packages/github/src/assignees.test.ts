import { describe, expect, it } from "vitest";
import { assigneeChange, compareAssignees, hashAssignees, type Member } from "./assignees";

const ana: Member = { userId: "u-ana", login: "Ana-GH", label: "ana@acme.test" };
const ben: Member = { userId: "u-ben", login: "ben-gh", label: "ben@acme.test" };
const cat: Member = { userId: "u-cat", login: null, label: "cat@acme.test" };
const members = [ana, ben, cat];
const run = (o: { pv?: string[]; gh?: string[]; base?: string; pvUnchanged?: boolean }) => compareAssignees({ members, pvIds: o.pv ?? [], ghLogins: o.gh ?? [], base: o.base, pvUnchanged: o.pvUnchanged });

describe("hashAssignees", () => it("ignores order, case and duplicates", () => expect(hashAssignees(["Ben-GH", "ana-gh", "ANA-GH"])).toBe(hashAssignees(["ana-gh", "ben-gh"]))));

describe("compareAssignees", () => {
  it("is in step when the matched people are the same, whatever the case", () => {
    expect(run({ pv: ["u-ana", "u-ben"], gh: ["BEN-gh", "ana-gh"], base: hashAssignees(["ana-gh"]) }).verdict).toBe("none");
  });
  it("only Product Velocity changed: send; only GitHub changed: github; both: both", () => {
    const base = hashAssignees(["ana-gh"]);
    expect(run({ pv: ["u-ana", "u-ben"], gh: ["ana-gh"], base }).verdict).toBe("send");
    expect(run({ pv: ["u-ana"], gh: ["ana-gh", "ben-gh"], base }).verdict).toBe("github");
    expect(run({ pv: ["u-ben"], gh: ["ana-gh", "ben-gh"], base }).verdict).toBe("both");
  });
  it("without a stored agreement: Product Velocity unchanged counts as the base, otherwise any difference is a conflict", () => {
    expect(run({ pv: ["u-ana"], gh: ["ana-gh", "ben-gh"], pvUnchanged: true }).verdict).toBe("github");
    expect(run({ pv: ["u-ana"], gh: ["ana-gh", "ben-gh"] }).verdict).toBe("both");
  });
  it("nobody assigned in Product Velocity and somebody in GitHub is a difference only GitHub has", () => {
    expect(run({ pv: [], gh: ["ana-gh"], base: hashAssignees([]) }).verdict).toBe("github");
    expect(run({ pv: [], gh: [] }).verdict).toBe("none");
  });
  it("a GitHub login nobody uses is left out of the comparison and kept when writing", () => {
    const r = run({ pv: ["u-ana"], gh: ["ana-gh", "stranger"], base: hashAssignees(["ana-gh"]) });
    expect(r.verdict).toBe("none");
    expect(r.ghUnmapped).toEqual(["stranger"]);
    expect(r.writeLogins).toEqual(["ana-gh", "stranger"]);
  });
  it("a Product Velocity assignee without a username is never written, and survives taking GitHub's people over", () => {
    const r = run({ pv: ["u-ana", "u-cat"], gh: ["ana-gh", "ben-gh"], base: hashAssignees(["ana-gh"]) });
    expect(r.pvNoLogin).toEqual(["cat@acme.test"]);
    expect(r.writeLogins).toEqual(["ana-gh"]);
    expect(r.pullUserIds).toEqual(["u-ana", "u-ben", "u-cat"]);
    expect(r.verdict).toBe("github");
  });
  it("labels the people for display and ignores ids that are not members", () => {
    const r = run({ pv: ["u-ana", "u-gone"], gh: ["ben-gh"] });
    expect(r.pvText).toBe("ana@acme.test");
    expect(r.githubText).toBe("ben@acme.test");
  });
});

describe("assigneeChange", () => {
  it("lists who is added and who is removed", () => {
    expect(assigneeChange(["ana-gh", "x"], ["Ana-GH", "ben-gh"])).toEqual({ add: ["ben-gh"], remove: ["x"] });
    expect(assigneeChange([], [])).toEqual({ add: [], remove: [] });
  });
});
