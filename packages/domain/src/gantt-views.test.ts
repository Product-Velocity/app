import { describe, expect, it } from "vitest";
import { GANTT_DEFAULT_VIEWS, GANTT_VIEW_NAMES } from "./gantt-views";
import { GANTT_FALLBACK, sanitizeGanttSettings } from "./gantt-settings";
import { sanitizeView } from "./views";
import { diffViews, changeSummary } from "./view-bar";

describe("Gantt views (issue #622)", () => {
  it("has three default views, each with its own timeline settings", () => {
    expect(GANTT_VIEW_NAMES).toEqual(["Prioritisation", "Planning", "Delivery"]);
    for (const n of GANTT_VIEW_NAMES) expect(GANTT_DEFAULT_VIEWS[n].gantt).toBeDefined();
    expect(GANTT_DEFAULT_VIEWS.Planning.gantt).toMatchObject({ zoom: "quarter", g1: "g2m_quarter", g2: "theme" });
    expect(GANTT_DEFAULT_VIEWS.Delivery.gantt).toMatchObject({ zoom: "week", g1: "home_project", g2: "team", density: "comfortable" });
    expect(GANTT_DEFAULT_VIEWS.Delivery.filters[0]).toMatchObject({ field: "initiative_phase", op: "any_of" });
  });
  it("drops unknown values and never groups by the same field twice", () => {
    expect(sanitizeGanttSettings({ zoom: "decade", g1: "nope", g2: "team", density: "huge" })).toEqual({ ...GANTT_FALLBACK, g2: "team" });
    expect(sanitizeGanttSettings({ zoom: "year", g1: "team", g2: "team", density: "comfortable" })).toEqual({ zoom: "year", g1: "team", g2: "", density: "comfortable" });
    expect(sanitizeGanttSettings({ zoom: "week", g1: "", g2: "team" })?.g2).toBe("");
    expect(sanitizeGanttSettings(null)).toBeUndefined();
    expect(sanitizeGanttSettings([1])).toBeUndefined();
  });
  it("keeps the settings in a view and leaves them out of views that have none", () => {
    expect(sanitizeView({ columns: [], filters: [], groupBy: null, gantt: { zoom: "year", g1: "", g2: "", density: "compact" } }).gantt?.zoom).toBe("year");
    expect("gantt" in sanitizeView({ columns: [], filters: [], groupBy: null })).toBe(false);
  });
  it("tells the unsaved-changes bar when only the timeline settings changed", () => {
    const a = GANTT_DEFAULT_VIEWS.Prioritisation, b = sanitizeView({ ...a, gantt: { ...a.gantt!, zoom: "week" } });
    const d = diffViews(a, b);
    expect(d.gantt).toBe(true);
    expect(changeSummary(d)).toBe("timeline settings");
    expect(diffViews(a, a).gantt).toBe(false);
  });
});
