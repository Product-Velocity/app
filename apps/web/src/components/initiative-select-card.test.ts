import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InitiativeSelectCard } from "./initiative-select-card";

const fields = [{ id: "customfield_10100", name: "Health", options: [{ id: "201", value: "On Track" }, { id: "202", value: "At Risk" }] }, { id: "customfield_10079", name: "Priority", options: [{ id: "301", value: "High" }] }];
const render = (over: object = {}) => renderToStaticMarkup(createElement(InitiativeSelectCard, { projectId: "p1", projectName: "RR", saved: {}, fields, action: async () => {}, readAt: "at 16:42 UTC", readHref: "/settings/integrations/jira/mapping?project=p1", ...over }));

describe("InitiativeSelectCard (Jira)", () => {
  it("is one compact row per field with the field choice, the direction, a Reset, and says when Jira was read, with a link to read again", () => {
    const h = render();
    for (const l of ["Health", "Initiative Status", "Initiative Phase"]) expect(h).toContain(`<th scope="row">${l}</th>`);
    expect((h.match(/class="btn">Reset</g) ?? []).length).toBe(3);
    expect(h).toContain("Read from Jira at 16:42 UTC");
    expect(h).toContain('href="/settings/integrations/jira/mapping?project=p1"');
    expect(h).toContain("Read from Jira now");
    expect(h).toContain(">Health</option>");
  });
  it("Initiative Phase has one direction and says it only goes to Jira; Health has two", () => {
    const h = render();
    expect(h).toContain("only goes from Product Velocity to Jira");
    expect(h.match(/aria-label="Initiative Phase: direction"[^>]*>.*?<\/select>/)![0]).not.toContain("Both ways");
    expect(h.match(/aria-label="Health: direction"[^>]*>.*?<\/select>/)![0]).toContain("Both ways");
    expect(h).toContain('type="hidden" name="seldir:jira.select.initiative_phase"');
  });
  it("a saved mapping shows its options, how many values are mapped, what the next Sync would write, and the built-in-name warning", () => {
    const h = render({ saved: { "jira.select.health": { field: "customfield_10100", direction: "two_way", options: { "On Track": "201", "At Risk": "202" } }, "jira.select.initiative_phase": { field: "customfield_10079", direction: "to_jira", options: { Build: "301" } } }, counts: { health: 4 } });
    expect(h).toContain("2 of 4 values mapped. Delayed and Blocked are not mapped, so they won&#x27;t be sent.");
    expect(h).toContain("Next Sync would write Health on 4 initiatives that have a value.");
    expect(h).toContain("has the name of a Jira built-in field");
  });
  it("lists the values to create in Jira, with a copy button", () => {
    const h = render();
    expect(h).toContain("Values to create in Jira");
    expect(h).toContain("Health: On Track, At Risk, Delayed, Blocked");
    expect(h).toContain("Copy the list");
  });
  it("says why there are no fields, and keeps Save off when Jira could not be read", () => {
    expect(render({ fields: null, fieldsError: "Jira could not be read just now." })).toContain("Jira could not be read just now.");
    expect(render({ fields: null })).toMatch(/disabled=""[^>]*>Save initiative fields/);
    expect(render({ fields: [] })).toContain("No custom single-select field is on the create screen");
  });
});
