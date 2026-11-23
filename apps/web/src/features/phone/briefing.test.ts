import { describe, expect, it } from "vitest";
import { briefingFacts, briefingFlags, briefingText, buildLine, gateLine, type BriefingRow } from "./briefing";

const row = (o: Record<string, unknown> = {}): BriefingRow => ({ id: "i1", item_code: "R-22", initiative_name: "Push digest", stack_rank: 22, home_project: "p1", ...o });
const person = (id: string) => ({ u1: "Dana K." })[id] ?? "";

describe("briefingFacts", () => {
  it("lists the facts in order with names, and leaves out what is empty", () => {
    const f = briefingFacts(row({ initiative_phase: "Build", initiative_status: "Active", product_manager: "u1", g2m_quarter: "Q1 2027", g2m_date_est: "2027-03-31", days_in_phase: 12 }), { person });
    expect(f.map((x) => `${x.label}: ${x.value}`)).toEqual(["Phase: Build", "Status: Active", "Owner: Dana K.", "Planned quarter: Q1 2027", "G2M date: 31 Mar 2027", "Days in phase: 12"]);
  });
  it("says Not set for the owner and the quarter only", () => {
    const f = briefingFacts(row(), { person });
    expect(f).toEqual([{ label: "Owner", value: "Not set" }, { label: "Planned quarter", value: "Not set" }]);
  });
  it("shows a name typed in an open list as it is", () => expect(briefingFacts(row({ product_manager: "Lee" }), { person })[0]).toEqual({ label: "Owner", value: "Lee" }));
  it("ignores a date that is not a date", () => expect(briefingFacts(row({ g2m_date_est: "soon" }), { person }).some((x) => x.label === "G2M date")).toBe(false));
});

describe("gateLine", () => {
  it("words the gate", () => {
    expect(gateLine(row({ current_gate: "B", gate_status: "In review" }))).toBe("Gate B, In review");
    expect(gateLine(row({ current_gate: "Gate A", gate_status: "Approved" }))).toBe("Gate A, Approved");
    expect(gateLine(row({ gate_status: "Not started" }))).toBe("No gate open");
    expect(gateLine(row())).toBe("No gate open");
  });
});

describe("buildLine", () => {
  it("combines status, progress and the tracker", () => {
    expect(buildLine(row({ status: "In Progress", delivery_progress_pct: 62.4, tracker_status: "In Review" }))).toEqual({ pct: 62, text: "Build In Progress · 62% built · tracker: In Review" });
  });
  it("clamps progress and returns nothing when there is nothing", () => {
    expect(buildLine(row({ delivery_progress_pct: 140 }))!.pct).toBe(100);
    expect(buildLine(row())).toBeNull();
  });
});

describe("briefingText", () => {
  it("prefers the description and clamps a long one", () => {
    const t = briefingText(row({ description: "x".repeat(400), hypothesis: "IF a THEN b" }));
    expect(t.short.endsWith("…")).toBe(true);
    expect(t.short.length).toBe(281);
    expect(t.more).toBe(true);
  });
  it("falls back to the hypothesis and has no more when it is short", () => {
    const t = briefingText(row({ hypothesis: "IF a THEN b" }));
    expect(t).toMatchObject({ short: "IF a THEN b", more: false });
  });
});

describe("briefingFlags", () => {
  it("uses the same words as the panel", () => {
    const flags = briefingFlags(row({ initiative_status: "Active", health: "Delayed" }), new Date("2027-04-14T00:00:00Z"));
    expect(flags.every((f) => f.label && f.text)).toBe(true);
    expect(flags.some((f) => f.label.toLowerCase().includes("risk") || f.text.includes("Delayed"))).toBe(true);
  });
});
