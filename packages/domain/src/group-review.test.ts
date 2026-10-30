import { describe, expect, it } from "vitest";
import { reviewGroup, type ReviewRow } from "./group-review";

const r = (code: string, name: string, o: Partial<ReviewRow> = {}): ReviewRow => ({ item_code: code, initiative_name: name, theme: "Roadmap views", initiative_phase: "Define", ...o });
const rows: ReviewRow[] = [
  r("R-1", "Timeline view of the roadmap", { summary: "Show initiatives on a timeline by quarter", g2m_date_est: "2026-12-01" }),
  r("R-2", "Gantt timeline for quarters", { summary: "A timeline chart of initiatives by quarter", g2m_date_est: "2027-02-01" }),
  r("R-3", "Cards view", { summary: "Cards grouped by status" }),
  r("R-4", "Billing export", { theme: "Payments", summary: "Export invoices" }),
  r("R-5", "Timeline view of the roadmap", { initiative_status: "Done" }),
];

describe("reviewGroup", () => {
  it("looks only at the subject's group and lists the closest first", () => {
    const v = reviewGroup(rows, { item: "R-1" });
    expect(v.group).toBe("Roadmap views");
    expect(v.siblings.map((s) => s.code)).not.toContain("R-4");
    expect(v.siblings.map((s) => s.code)).not.toContain("R-1");
    expect(v.siblings[0]!.code).toBe("R-5");
    expect(v.read_first.length).toBeLessThanOrEqual(5);
    expect(v.read_first).toContain("R-2");
  });
  it("finds a same-name duplicate, a possible overlap and the missing link, with evidence", () => {
    const v = reviewGroup(rows, { item: "R-1" });
    expect(v.findings.find((f) => f.kind === "same_name")).toMatchObject({ with: ["R-5"] });
    const overlap = v.findings.find((f) => f.kind === "possible_overlap" && f.with[0] === "R-2");
    expect(overlap?.evidence).toMatch(/R-2/);
    expect(v.findings.find((f) => f.kind === "missing_relation" && f.with[0] === "R-2")).toBeTruthy();
    expect(v.findings.find((f) => f.with[0] === "R-3")).toBeUndefined();
  });
  it("does not ask for a link that exists, in either direction", () => {
    const linked = rows.map((x) => (x.item_code === "R-1" ? { ...x, related_to: "R-2" } : x));
    expect(reviewGroup(linked, { item: "R-1" }).findings.some((f) => f.kind === "missing_relation" && f.with[0] === "R-2")).toBe(false);
    const reverse = rows.map((x) => (x.item_code === "R-2" ? { ...x, depends_on: "R-1" } : x));
    expect(reviewGroup(reverse, { item: "R-1" }).findings.some((f) => f.kind === "missing_relation" && f.with[0] === "R-2")).toBe(false);
  });
  it("flags a G2M before the item it depends on, and a start before a dependency is ready", () => {
    const dep = rows.map((x) => (x.item_code === "R-1" ? { ...x, depends_on: "R-2", start_date: "2026-11-01" } : x));
    const v = reviewGroup(dep, { item: "R-1" });
    expect(v.findings.find((f) => f.kind === "date_conflict")?.evidence).toMatch(/2026-12-01.*2027-02-01/);
    expect(v.findings.find((f) => f.kind === "dependency_unfinished")).toBeTruthy();
    const done = dep.map((x) => (x.item_code === "R-2" ? { ...x, initiative_status: "Done" } : x));
    expect(reviewGroup(done, { item: "R-1" }).findings.some((f) => f.kind === "dependency_unfinished")).toBe(false);
  });
  it("works from a group and a brief that is not an initiative yet", () => {
    const v = reviewGroup(rows, { group: "roadmap views", brief: "A timeline of initiatives by quarter" });
    expect(v.subject).toBeNull();
    expect(v.siblings[0]!.similarity).toBeGreaterThan(0.3);
    expect(v.findings).toEqual([]);
  });
  it("says so when there is nothing to review", () => {
    expect(reviewGroup(rows, {}).notes[0]).toMatch(/Give a group/);
    expect(reviewGroup([r("R-9", "Lone", { theme: null })], { item: "R-9" }).notes[0]).toMatch(/no Initiative Group/);
    expect(reviewGroup(rows, { group: "Nothing here" }).notes[0]).toMatch(/No initiatives in the group/);
  });
  it("never reports anything about people", () => {
    expect(JSON.stringify(reviewGroup(rows, { item: "R-1" }))).not.toMatch(/product_manager|sponsor|velocity|load/i);
  });
});
