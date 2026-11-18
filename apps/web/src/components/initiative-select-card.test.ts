import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InitiativeSelectCard } from "./initiative-select-card";

const fields = [{ id: "customfield_10100", name: "Health", options: [{ id: "201", value: "On Track" }, { id: "202", value: "At Risk" }] }];
const render = (over: object = {}) => renderToStaticMarkup(createElement(InitiativeSelectCard, { projectId: "p1", projectName: "RR", saved: {}, fields, action: async () => {}, ...over }));

describe("InitiativeSelectCard", () => {
  it("has one fieldset per slot, the Jira fields and their options, and says the phase only goes to Jira", () => {
    const h = render();
    for (const l of ["Health", "Initiative Status", "Initiative Phase"]) expect(h).toContain(`<legend>${l}</legend>`);
    expect(h).toContain("Health (customfield_10100)");
    expect(h).toContain("On Track");
    expect(h).toContain("only goes from Product Velocity to Jira");
    expect(h).toContain('name="selfield:jira.select.initiative_phase"');
    // the phase has one direction only; Health has two
    expect(h.match(/name="seldir:jira\.select\.initiative_phase".*?<\/select>/)![0]).not.toContain("Both ways");
    expect(h.match(/name="seldir:jira\.select\.health".*?<\/select>/)![0]).toContain("Both ways");
  });
  it("keeps the saved choice selected", () => {
    const h = render({ saved: { "jira.select.health": { field: "customfield_10100", direction: "two_way", options: { "At Risk": "202" } } } });
    expect(h).toMatch(/<option value="customfield_10100" selected/);
    expect(h).toMatch(/<option value="202" selected/);
  });
  it("says so when the site could not be read, and when there is no select field; the save button is off then", () => {
    expect(render({ fields: null, fieldsError: "Jira could not be read." })).toContain("Jira could not be read.");
    expect(render({ fields: null })).toMatch(/disabled=""[^>]*>Save initiative fields/);
    expect(render({ fields: [] })).toContain("has no custom single-select field");
  });
});
