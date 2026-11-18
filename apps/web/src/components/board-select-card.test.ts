import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BoardSelectCard } from "./board-select-card";

const fields = [{ id: "fh", name: "Health", dataType: "SINGLE_SELECT" as const, options: [{ id: "1", name: "Green" }, { id: "2", name: "Amber" }] }, { id: "fn", name: "Notes", dataType: "TEXT" as const }];
const render = (over: object = {}) => renderToStaticMarkup(createElement(BoardSelectCard, { projectId: "p1", projectName: "Platform", boardTitle: "Roadmap", saved: undefined, fields, action: async () => {}, ...over }));

describe("BoardSelectCard", () => {
  it("has one fieldset per slot with the board's single-select fields and options only, and says the phase only goes to GitHub", () => {
    const h = render();
    for (const l of ["Health", "Initiative Status", "Initiative Phase"]) expect(h).toContain(`<legend>${l}</legend>`);
    expect(h).toContain(">Health</option>");
    expect(h).not.toContain(">Notes</option>");
    expect(h).toContain("Green");
    expect(h).toContain("only goes from Product Velocity to GitHub");
    expect(h.match(/name="bseldir:initiative_phase".*?<\/select>/)![0]).not.toContain("Both ways");
    expect(h.match(/name="bseldir:health".*?<\/select>/)![0]).toContain("Both ways");
  });
  it("keeps the saved choice selected", () => {
    const h = render({ saved: { health: { field: { id: "fh", name: "Health" }, direction: "two_way", options: { "At Risk": "Amber" } } } });
    expect(h).toMatch(/<option value="fh" selected/);
    expect(h).toMatch(/<option value="Amber" selected/);
  });
  it("says so when the board could not be read, or has no single select; the save button is off when it could not be read", () => {
    expect(render({ fields: null, fieldsError: "GitHub could not be asked." })).toContain("GitHub could not be asked.");
    expect(render({ fields: null })).toMatch(/disabled=""[^>]*>Save initiative fields/);
    expect(render({ fields: [fields[1]] })).toContain("no single-select field");
  });
});
