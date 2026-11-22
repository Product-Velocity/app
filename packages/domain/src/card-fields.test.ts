import { describe, expect, it } from "vitest";
import { CARD_FIELD_LIMIT, cardColumns, cardDate, cardFieldKeys, cardFieldOffer, healthSegments, initialsOf, moscowTone, sizeSummary, stageAge } from "./card-fields";

const TODAY = new Date("2026-11-22T00:00:00Z");

describe("cardFieldOffer", () => {
  it("draws each type its own way", () => {
    expect(cardFieldOffer("moscow")).toEqual({ ok: true, render: "pill" });
    expect(cardFieldOffer("effort")).toEqual({ ok: true, render: "size" });
    expect(cardFieldOffer("g2m_date_est")).toEqual({ ok: true, render: "date" });
    expect(cardFieldOffer("delivery_progress_pct")).toEqual({ ok: true, render: "progress" });
    expect(cardFieldOffer("contributing_teams")).toEqual({ ok: true, render: "pill" });
  });
  it("refuses fixed and long fields with a reason", () => {
    expect(cardFieldOffer("health")).toEqual({ ok: false, reason: "Always on the card" });
    expect(cardFieldOffer("product_manager").ok).toBe(false);
    expect(cardFieldOffer("initiative_name").ok).toBe(false);
    const long = cardFieldOffer("github_links");
    expect(long.ok).toBe(false);
  });
});

describe("cardFieldKeys", () => {
  it("keeps the view's order, drops fixed, ineligible and axis fields, and stops at five", () => {
    const cols = ["stack_rank", "item_code", "initiative_name", "health", "moscow", "effort", "g2m_date_est", "audience", "status", "focus_area", "product_manager"];
    expect(cardFieldKeys(cols)).toEqual(["moscow", "effort", "g2m_date_est", "audience", "status"]);
    expect(cardFieldKeys(cols, ["audience"])).toEqual(["moscow", "effort", "g2m_date_est", "status", "focus_area"]);
    expect(cardFieldKeys(cols)).toHaveLength(CARD_FIELD_LIMIT);
  });
  it("ignores duplicates", () => expect(cardFieldKeys(["moscow", "moscow"])).toEqual(["moscow"]));
});

describe("cardColumns", () => {
  it("is the core columns plus the chosen fields, at most five", () => {
    expect(cardColumns(["moscow", "effort", "health", "a", "b", "g2m_date_est", "audience", "status", "focus_area"])).toEqual(["stack_rank", "item_code", "initiative_name", "moscow", "effort", "g2m_date_est", "audience", "status"]);
  });
});

describe("display helpers", () => {
  it("formats dates without the year when it is this year", () => {
    expect(cardDate("2026-03-12", TODAY)).toBe("Mar 12");
    expect(cardDate("2027-01-05", TODAY)).toBe("Jan 5, 2027");
    expect(cardDate(null, TODAY)).toBe("");
    expect(cardDate("soon", TODAY)).toBe("");
  });
  it("maps MoSCoW to a weight", () => {
    expect(moscowTone("Must")).toBe("must");
    expect(moscowTone("Won't")).toBe("wont");
    expect(moscowTone("Maybe")).toBeNull();
  });
  it("sums sizes biggest first", () => {
    expect(sizeSummary(["S", "L", "L", "L", "M", "S", null, "huge"])).toBe("3L 1M 2S");
    expect(sizeSummary([])).toBe("");
  });
  it("makes initials", () => {
    expect(initialsOf("tom.reyes")).toBe("TR");
    expect(initialsOf("priya")).toBe("PR");
  });
  it("counts health worst first", () => {
    expect(healthSegments(["On Track", "Blocked", "On Track", "", null, "At Risk"])).toEqual([
      { health: "Blocked", count: 1 }, { health: "At Risk", count: 1 }, { health: "On Track", count: 2 }, { health: "No health", count: 2 },
    ]);
  });
});

describe("stageAge", () => {
  const row = (extra: object) => ({ initiative_phase: "Define", phase_changed_at: "2026-10-01", ...extra });
  it("shows from half the limit and marks past the limit", () => {
    expect(stageAge(row({ phase_changed_at: "2026-11-10" }), TODAY)).toBeNull(); // 12 days of 30
    expect(stageAge(row({ phase_changed_at: "2026-11-01" }), TODAY)).toEqual({ days: 21, over: false });
    expect(stageAge(row({}), TODAY)).toEqual({ days: 52, over: true });
  });
  it("stays quiet for finished, held and undated items", () => {
    expect(stageAge(row({ initiative_status: "On hold" }), TODAY)).toBeNull();
    expect(stageAge(row({ initiative_status: "Completed" }), TODAY)).toBeNull();
    expect(stageAge(row({ phase_changed_at: null }), TODAY)).toBeNull();
    expect(stageAge({ initiative_phase: "Completed", phase_changed_at: "2020-01-01" }, TODAY)).toBeNull();
  });
});
