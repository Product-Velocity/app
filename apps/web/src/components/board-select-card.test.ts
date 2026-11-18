import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BoardSelectCard } from "./board-select-card";

const fields = [{ id: "fh", name: "Health", dataType: "SINGLE_SELECT" as const, options: [{ id: "1", name: "Green" }, { id: "2", name: "Amber" }] }, { id: "fn", name: "Notes", dataType: "TEXT" as const }];
const render = (over: object = {}) => renderToStaticMarkup(createElement(BoardSelectCard, { projectId: "p1", projectName: "Platform", boardTitle: "Roadmap", saved: undefined, fields, action: async () => {}, readAt: "at 16:42 UTC", readHref: "/settings/integrations/github/mapping?project=p1", ...over }));

describe("BoardSelectCard (GitHub)", () => {
  it("is the same compact rows as Jira, with the board's single-select fields only, and says the phase only goes to GitHub", () => {
    const h = render();
    for (const l of ["Health", "Initiative Status", "Initiative Phase"]) expect(h).toContain(`<th scope="row">${l}</th>`);
    expect(h).toContain(">Health</option>");
    expect(h).not.toContain(">Notes</option>");
    expect(h).toContain("only goes from Product Velocity to GitHub");
    expect(h).toContain("Read from GitHub at 16:42 UTC");
    expect(h).toContain("Read from GitHub now");
    expect(h).toContain('name="bseldir:health"');
  });
  it("keeps the saved choice, counts the mapped values and says what the next Sync would write", () => {
    const h = render({ saved: { health: { field: { id: "fh", name: "Health" }, direction: "two_way", options: { "At Risk": "Amber" } } }, counts: { health: 1 } });
    expect(h).toContain("1 of 4 values mapped.");
    expect(h).toContain("Next Sync would write Health on 1 initiative that has a value.");
  });
  it("says so when the board could not be read, or has no single select; Save is off when it could not be read", () => {
    expect(render({ fields: null, fieldsError: "GitHub could not be asked." })).toContain("GitHub could not be asked.");
    expect(render({ fields: null })).toMatch(/disabled=""[^>]*>Save initiative fields/);
    expect(render({ fields: [fields[1]] })).toContain("has no single-select field to use");
  });
});
