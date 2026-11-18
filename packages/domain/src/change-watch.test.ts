import { describe, expect, it } from "vitest";
import { changeBadge, changeBreakdownText, changeLogHref, totalChanges, watchedProjects, type ChangeCountRow } from "./change-watch";

const row = (o: Partial<ChangeCountRow>): ChangeCountRow => ({ tenant_id: "t1", tenant_name: "Acme", project_id: "p1", project_name: "Platform", change_type: "health", n: 1, latest_at: "2027-04-14T10:00:00Z", ...o });

describe("watchedProjects", () => {
  it("groups by account and project, sums, orders types like the report and the newest project first", () => {
    const list = watchedProjects([
      row({ change_type: "phase", n: 2, latest_at: "2027-04-14T09:00:00Z" }),
      row({ change_type: "health", n: 3 }),
      row({ tenant_id: "t2", tenant_name: "Beta", project_id: "p1", project_name: "Platform", n: 4, latest_at: "2027-04-14T12:00:00Z" }),
    ]);
    expect(list.map((p) => `${p.tenantName}/${p.projectName}`)).toEqual(["Beta/Platform", "Acme/Platform"]); // same project id in two accounts stays two projects
    const acme = list[1]!;
    expect(acme.total).toBe(5);
    expect(acme.latestAt).toBe("2027-04-14T10:00:00Z");
    expect(acme.byType.map((t) => `${t.label}:${t.n}`)).toEqual(["Phase:2", "Health:3"]);
    expect(totalChanges(list)).toBe(9);
    expect(changeBreakdownText(acme)).toBe("2 Phase, 3 Health");
  });
  it("counts an unknown type in the total only and ignores empty rows", () => {
    const [p] = watchedProjects([row({ change_type: "future-type", n: 2 }), row({ n: 0 })]);
    expect(p!.total).toBe(2);
    expect(p!.byType).toEqual([]);
    expect(watchedProjects([])).toEqual([]);
  });
});
describe("badge and link", () => {
  it("shows the sum, capped at 99+", () => { expect([changeBadge(1), changeBadge(99), changeBadge(100)]).toEqual(["1", "99", "99+"]); });
  it("opens the Changes report of that project in that account", () => { expect(changeLogHref("t1", "p9")).toBe("/w/t1/reports?report=changes&scope=p:p9"); });
});
