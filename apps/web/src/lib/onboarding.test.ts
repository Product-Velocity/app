import { describe, expect, it } from "vitest";
import { CONNECT_CARDS, WIZARD_STEPS, INVITE_STEPS, firstThings, checklist, checklistDismissed, hasFinishedOnboarding, parseAboutYou, showChecklist, withOnboarded } from "./onboarding";

describe("parseAboutYou", () => {
  it("accepts nothing at all: skipping is free", () => expect(parseAboutYou({})).toEqual({ ok: true, value: { fullName: "", role: "", goal: "" } }));
  it("tidies the name and keeps listed choices", () => {
    expect(parseAboutYou({ fullName: "  Ana   Ruiz ", role: "Founder", goal: "Report to leadership" })).toEqual({ ok: true, value: { fullName: "Ana Ruiz", role: "Founder", goal: "Report to leadership" } });
  });
  it("refuses a long name and unlisted choices", () => {
    expect(parseAboutYou({ fullName: "a".repeat(121) }).ok).toBe(false);
    expect(parseAboutYou({ role: "CEO of everything" }).ok).toBe(false);
    expect(parseAboutYou({ goal: "<script>" }).ok).toBe(false);
  });
});

describe("finished workspaces", () => {
  it("remembers each workspace once", () => {
    const a = withOnboarded({}, "t1");
    expect(a).toEqual(["t1"]);
    expect(withOnboarded({ onboarded_tenants: a }, "t1")).toEqual(["t1"]);
    expect(withOnboarded({ onboarded_tenants: a }, "t2")).toEqual(["t1", "t2"]);
    expect(hasFinishedOnboarding({ onboarded_tenants: a }, "t2")).toBe(false);
  });
  it("ignores junk in the profile", () => {
    expect(hasFinishedOnboarding({ onboarded_tenants: "t1" }, "t1")).toBe(false);
    expect(checklistDismissed({ checklist_dismissed: [1, "t1"] }, "t1")).toBe(true);
  });
});

describe("checklist", () => {
  const none = { members: 1, pendingInvites: 0, items: 0, trackers: 0 };
  it("starts with nothing done", () => expect(checklist(none).done).toBe(0));
  it("counts an invite or a second member as inviting the team", () => {
    expect(checklist({ ...none, pendingInvites: 1 }).items.find((i) => i.key === "invite")!.done).toBe(true);
    expect(checklist({ ...none, members: 2 }).items.find((i) => i.key === "invite")!.done).toBe(true);
  });
  it("hides when closed or complete", () => {
    expect(showChecklist({}, "t1", none)).toBe(true);
    expect(showChecklist({ checklist_dismissed: ["t1"] }, "t1", none)).toBe(false);
    expect(showChecklist({}, "t1", { members: 2, pendingInvites: 0, items: 3, trackers: 1 })).toBe(false);
    expect(showChecklist({ checklist_dismissed: ["t1"] }, "t2", none)).toBe(true);
  });
});

describe("invited people", () => {
  it("the first things always include reading and peeking, and quick-add only where the role can edit", () => {
    const viewer = firstThings(false).map((t) => t.title);
    expect(viewer).toContain("Read the roadmap");
    expect(viewer).not.toContain("Add an item fast");
    expect(firstThings(true).map((t) => t.title)).toContain("Add an item fast");
  });
  it("shows three steps on the invitation page", () => expect(INVITE_STEPS).toHaveLength(3));
});

describe("connect step and checklist parity", () => {
  it("offers GitHub and Jira as equals, each with its own screen", () => {
    const keys = CONNECT_CARDS.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["github", "jira", "claude"]));
    expect(CONNECT_CARDS.find((c) => c.key === "github")!.href).toBe("/settings/integrations/github");
    expect(CONNECT_CARDS.find((c) => c.key === "jira")!.href).toBe("/settings/integrations/jira");
  });
  it("the checklist links to both trackers and to real screens", () => {
    const t = checklist({ members: 1, pendingInvites: 0, items: 0, trackers: 0 }).items.find((i) => i.key === "tracker")!;
    expect([t.href, t.altHref]).toEqual(["/settings/integrations/github", "/settings/integrations/jira"]);
  });
  it("the owner wizard has four steps ending in Connect", () => expect(WIZARD_STEPS.map((s) => s.key)).toEqual(["workspace", "about", "invite", "connect"]));
});
