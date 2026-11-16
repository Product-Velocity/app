import { describe, expect, it } from "vitest";
import { nextStep, sectionPath, setupComplete, setupSteps, TRACKER_SECTIONS } from "./sections";

describe("tracker settings sections", () => {
  it("has the same five sections in setup order, and only the first works without a connection", () => {
    expect(TRACKER_SECTIONS.map((s) => s.id)).toEqual(["connection", "projects", "mapping", "inbox", "logs"]);
    expect(TRACKER_SECTIONS.filter((s) => !s.needsConnection).map((s) => s.id)).toEqual(["connection"]);
  });
  it("builds an address per section from the tracker's base", () => {
    expect(sectionPath("/settings/integrations/jira", "connection")).toBe("/settings/integrations/jira");
    expect(sectionPath("/settings/integrations/jira", "mapping")).toBe("/settings/integrations/jira/mapping");
    expect(sectionPath("/settings/integrations/github", "logs")).toBe("/settings/integrations/github/logs");
  });
  it("asks to connect first, then to link a project, and is complete after that", () => {
    const at = (connected: boolean, linkedProjects: number, customised = false) => nextStep(setupSteps({ tracker: "Jira", connected, linkedProjects, customised }));
    expect(at(false, 0)?.id).toBe("connect");
    expect(at(false, 3)?.id).toBe("connect");
    expect(at(true, 0)?.id).toBe("link");
    expect(at(true, 2)).toBeNull();
  });
  it("never requires the field mapping: the defaults work", () => {
    const steps = setupSteps({ tracker: "GitHub", connected: true, linkedProjects: 1, customised: false });
    expect(steps[2]).toMatchObject({ done: false, optional: true });
    expect(setupComplete(steps)).toBe(true);
  });
});
