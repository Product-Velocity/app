import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InitiativeStatusSyncCard } from "./initiative-status-sync-card";
import type { JiraStatusOption } from "@/lib/atlassian/jira-status-map";

const options: JiraStatusOption[] = [{ id: "1", name: "Backlog", category: "new" }, { id: "2", name: "WIP Research", category: "indeterminate" }, { id: "3", name: "Done", category: "done" }];
const action = async () => {};
const html = (p: Partial<Parameters<typeof InitiativeStatusSyncCard>[0]> = {}) => renderToStaticMarkup(createElement(InitiativeStatusSyncCard, { projectId: "p1", projectName: "Platform", saved: null, options, action, ...p }));

describe("InitiativeStatusSyncCard", () => {
  it("is off until saved, suggests same-name statuses, and says what it never does", () => {
    const h = html();
    expect(h).not.toMatch(/name="status-sync"[^>]*checked/);
    expect(h).toMatch(/suggested: same name/);
    expect(h).toMatch(/<option value="1" selected="">Backlog \(to do\)/);
    expect(h).toMatch(/never an epic, story or task/);
    expect(h).toMatch(/never changes Build Status/);
  });
  it("shows a saved mapping as on, with its statuses selected and no suggestion for them", () => {
    const h = html({ saved: { Active: "2" } });
    expect(h).toMatch(/name="status-sync"[^>]*checked/);
    expect(h).toMatch(/<option value="2" selected="">WIP Research/);
  });
  it("cannot be saved when Jira could not be read, and says why", () => {
    const h = html({ options: null, error: "Jira could not be read just now." });
    expect(h).toMatch(/Jira could not be read just now\./);
    expect(h.match(/disabled/g)!.length).toBeGreaterThanOrEqual(3);
  });
});
