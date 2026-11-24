import { describe, expect, it } from "vitest";
import { splitName, CONNECT_CARDS, WIZARD_STEPS, INVITE_STEPS, firstThings, checklist, checklistDismissed, hasFinishedOnboarding, parseAboutYou, showChecklist, withOnboarded } from "./onboarding";

describe("parseAboutYou", () => {
  it("asks for a first name when the step is filled in; skipping the whole step is a separate button", () => {
    expect(parseAboutYou({}).ok).toBe(false);
    expect(parseAboutYou({ firstName: "  ", lastName: "Ruiz" }).ok).toBe(false);
  });
  it("keeps first and last name apart and joins them for the rest of the app", () => {
    expect(parseAboutYou({ firstName: "  Ana ", lastName: " Ruiz  Gil", role: "Founder", goal: "Report to leadership" })).toEqual({
      ok: true, value: { firstName: "Ana", lastName: "Ruiz Gil", fullName: "Ana Ruiz Gil", role: "Founder", goal: "Report to leadership" },
    });
    expect(parseAboutYou({ firstName: "Ana" })).toEqual({ ok: true, value: { firstName: "Ana", lastName: "", fullName: "Ana", role: "", goal: "" } });
  });
  it("refuses long names and unlisted choices", () => {
    expect(parseAboutYou({ firstName: "a".repeat(61) }).ok).toBe(false);
    expect(parseAboutYou({ firstName: "Ana", lastName: "b".repeat(61) }).ok).toBe(false);
    expect(parseAboutYou({ firstName: "Ana", role: "CEO of everything" }).ok).toBe(false);
    expect(parseAboutYou({ firstName: "Ana", goal: "<script>" }).ok).toBe(false);
  });
});

describe("splitName (prefill)", () => {
  it("prefers what onboarding stored, then Google's given and family name, then the full name split", () => {
    expect(splitName({ first_name: "Ana", last_name: "Ruiz", given_name: "X" })).toEqual({ first: "Ana", last: "Ruiz" });
    expect(splitName({ given_name: "Jo", family_name: "Park" })).toEqual({ first: "Jo", last: "Park" });
    expect(splitName({ full_name: "ashu mathura" })).toEqual({ first: "ashu", last: "mathura" });
    expect(splitName({ name: "Cher" })).toEqual({ first: "Cher", last: "" });
    expect(splitName({})).toEqual({ first: "", last: "" });
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
  const none = { projects: 0, members: 1, pendingInvites: 0, items: 0, trackers: 0 };
  it("starts with nothing done", () => expect(checklist(none).done).toBe(0));
  it("counts an invite or a second member as inviting the team", () => {
    expect(checklist({ ...none, pendingInvites: 1 }).items.find((i) => i.key === "invite")!.done).toBe(true);
    expect(checklist({ ...none, members: 2 }).items.find((i) => i.key === "invite")!.done).toBe(true);
  });
  it("starts with the project, then the first initiative, the team and a tracker, as one path", () => {
    expect(checklist(none).items.map((i) => i.key)).toEqual(["project", "item", "invite", "tracker"]);
    expect(checklist({ ...none, projects: 1 }).items.find((i) => i.key === "project")!.done).toBe(true);
  });
  it("hides when closed or complete", () => {
    expect(showChecklist({}, "t1", none)).toBe(true);
    expect(showChecklist({ checklist_dismissed: ["t1"] }, "t1", none)).toBe(false);
    expect(showChecklist({}, "t1", { projects: 1, members: 2, pendingInvites: 0, items: 3, trackers: 1 })).toBe(false);
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
    const t = checklist({ projects: 0, members: 1, pendingInvites: 0, items: 0, trackers: 0 }).items.find((i) => i.key === "tracker")!;
    expect([t.href, t.altHref]).toEqual(["/settings/integrations/github", "/settings/integrations/jira"]);
  });
  it("the owner wizard has four steps ending in Connect", () => expect(WIZARD_STEPS.map((s) => s.key)).toEqual(["workspace", "about", "invite", "connect"]));
});
